/**
 * AFLDB-ISSUE-246 — retire the orphaned, retained AFLDB-ISSUE-109 DEV validation fixture
 * override through one audited, fail-closed lifecycle action.
 *
 *     # validate only (READ ONLY transaction, writes nothing):
 *     npm run db:issue246:retire-issue109-fixture -- --environment dev --actor-email <super admin>
 *     # the one mutation:
 *     npm run db:issue246:retire-issue109-fixture -- --environment dev --actor-email <super admin> --apply
 *
 * WHY. ISSUE-109 (issues/closed/AFLDB-ISSUE-109.md) accepted its Data Editor runtime gate on a
 * dedicated, intentionally RETAINED development fixture: match 17059, match_key
 * '2026|R30|2026-12-31|104|103', whose one active `matches`/`notes` override holds the exact
 * baseline marker below. It warned that Delete Match would strand that natural-key override and
 * that removal needed a separately approved, audited action. The fixture match was later deleted
 * on the old DEV lineage (ISSUE-139 Phase 4C′ records the deletion audit), and the 2026-09-06 DEV
 * promotion (ISSUE-139 Phase 4E) then reinstated `data_overrides` verbatim while withholding
 * `data_edits` as historical-only (ISSUE-139 D2). afldb_dev therefore holds an ACTIVE override
 * whose canonical match does not exist, and ISSUE-237 L4 A4.3 correctly refuses to promote it,
 * because the replay would silently lose it. This tool is that separately approved action. It is
 * bound to exactly this one fixture. It is not a generic "deactivate an override" command.
 *
 * WHAT IT DOES. One transaction: prove the target and the fixture, set the one override row
 * `is_active = false, updated_at = now()`, append one `auth_audit_log` row
 * (`action = 'data_override.retired'`), re-read and re-prove the retired state, commit. It deletes
 * nothing. The override row, its payload, its `admin_user_id` (the ISSUE-109 author) and its
 * `created_at` are preserved, and no `data_edits` row is read for identity or written.
 *
 * WHY auth_audit_log AND NOT data_edits (operator decision, 2026-09-25). `data_edits.row_id` is a
 * surrogate id in players/matches/coaches. The fixture's id 17059 belongs to the REPLACED lineage
 * and may name a different, real match in afldb_dev today, so a `data_edits` row about it would
 * be fabricated. `data_edits` is also historical-only on a DEV promotion, so the next DEV
 * promotion would drop the record. `auth_audit_log` is append-only, is reinstated in full by every
 * promotion, holds the `database.promoted` markers this tool relies on, and binds by natural key
 * and override id, not by a lineage-bound row id.
 *
 * HISTORICAL EVIDENCE (operator decision, 2026-09-25). ISSUE-109's accepted audit rows 22–25 are
 * NOT on afldb_dev. They were withheld by the DEV promotion and survive only in its dump and the
 * rollback database, which this tool deliberately does not depend on. The live guard proves
 * instead: the one override row carries ISSUE-109's recorded provenance (id, author, exact
 * payload, a 2026-08-30 timestamp window); its canonical match is absent; no current `data_edits`
 * row purports to be the fixture's audit chain; and at least one later DEV `database.promoted`
 * marker records `data_edits` as historical-only, which accounts for the chain's absence.
 *
 * TARGET SAFETY. The only accepted environment is `dev` and the only accepted database is
 * exactly `afldb_dev`: by the DSN's own path BEFORE any connection, and by `current_database()`
 * inside the transaction. The DSN comes only from AFLDB_OWNER_DATABASE_URL and is never printed.
 * There is no production path, no database/key/payload argument and no force flag.
 */
import postgres, { type TransactionSql } from 'postgres';

import { redact } from '../db/psql';
import { databaseOf } from '../db/rebuild-test';

export class Issue246Refused extends Error {}

export const ISSUE246 = 'AFLDB-ISSUE-246';
export const ISSUE246_TARGET_DATABASE = 'afldb_dev';
export const ISSUE246_ENVIRONMENT = 'dev';
export const ISSUE246_DSN_ENV = 'AFLDB_OWNER_DATABASE_URL';
export const RETIREMENT_ACTION = 'data_override.retired';
export const RETIREMENT_OPERATION = 'override_retirement';
export const RETIREMENT_ACTOR_LABEL = `operator: retire ISSUE-109 fixture override (${ISSUE246})`;
export const PROMOTION_MARKER_ACTION = 'database.promoted';
const TOOL_PATH = 'tools/maintenance/issue246-retire-issue109-fixture.ts';

export const ISSUE109_BASELINE_NOTES =
  'AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN';

/**
 * The immutable historical specification of the one target. Every value comes from the
 * repository's records, never from the database:
 * - key, group, payload, author (4) and the 2026-08-30 acceptance date:
 *   issues/closed/AFLDB-ISSUE-109.md "Final execution evidence";
 * - override id 1: issues.md, ISSUE-139 Phase 4E §8.1 ("the single active override (id 1, …)").
 *
 * The acceptance record gives a calendar date without a zone, so the window is 2026-08-30 in
 * every zone from UTC-12 to UTC+14. 17059 and rows 22–25 are REPLACED-lineage facts. They are
 * recorded in the audit as provenance and are never used as a lookup key.
 */
export const ISSUE109_FIXTURE = {
  entityType: 'matches',
  entityKey: '2026|R30|2026-12-31|104|103',
  fieldGroup: 'notes',
  overrideId: 1,
  adminUserId: 4,
  provenanceFromIso: '2026-08-29T10:00:00.000Z',
  provenanceToIso: '2026-08-31T12:00:00.000Z',
  replacedLineageMatchId: 17059,
  replacedLineageAuditRows: [22, 23, 24, 25],
} as const;

export function expectedOverrideValues(): { notes: string } {
  return { notes: ISSUE109_BASELINE_NOTES };
}

// ---------------------------------------------------------------------------
// Arguments and target (all refusals here happen before any connection)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Issue246Args = { environment: typeof ISSUE246_ENVIRONMENT; actorEmail: string; apply: boolean };

/** `--environment dev --actor-email <addr> [--apply]`. Nothing else is accepted. */
export function parseIssue246Args(argv: readonly string[]): Issue246Args {
  let environment: string | undefined;
  let actorEmail: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') {
      if (apply) throw new Issue246Refused('--apply was given more than once.');
      apply = true;
      continue;
    }
    if (flag !== '--environment' && flag !== '--actor-email') {
      throw new Issue246Refused(
        `Unknown argument ${JSON.stringify(flag)}. The only arguments are --environment dev, `
        + '--actor-email <super admin> and --apply; the target fixture is fixed in code.');
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Issue246Refused(`${flag} needs a value.`);
    if (flag === '--environment') {
      if (environment !== undefined) throw new Issue246Refused('--environment was given more than once.');
      environment = value;
    } else {
      if (actorEmail !== undefined) throw new Issue246Refused('--actor-email was given more than once.');
      actorEmail = value;
    }
    i += 1;
  }
  if (environment === undefined) throw new Issue246Refused('--environment dev is required.');
  if (environment !== ISSUE246_ENVIRONMENT) {
    throw new Issue246Refused(
      `--environment ${JSON.stringify(environment)} is refused: the only environment is 'dev'. `
      + 'The ISSUE-109 fixture is a DEV-only artefact and this tool has no production path.');
  }
  if (actorEmail === undefined) throw new Issue246Refused('--actor-email is required (an enabled, enrolled super_admin).');
  const email = actorEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Issue246Refused(`--actor-email ${JSON.stringify(actorEmail)} is not a valid email address.`);
  return { environment: ISSUE246_ENVIRONMENT, actorEmail: email, apply };
}

export function assertIssue246Database(database: string, label: string): void {
  if (database !== ISSUE246_TARGET_DATABASE) {
    throw new Issue246Refused(
      `${label} is '${database}'; the only ${ISSUE246} target is '${ISSUE246_TARGET_DATABASE}'.`);
  }
}

/** The DSN from the environment only. Refusals name the variable and database, never the DSN. */
export function resolveIssue246Dsn(env: Record<string, string | undefined>): string {
  const dsn = env[ISSUE246_DSN_ENV]?.trim();
  if (!dsn) throw new Issue246Refused(`${ISSUE246_DSN_ENV} is not set.`);
  let named: string;
  try {
    named = databaseOf(dsn);
  } catch {
    throw new Issue246Refused(`${ISSUE246_DSN_ENV} is not a valid connection URL.`);
  }
  assertIssue246Database(named, `${ISSUE246_DSN_ENV}'s database`);
  return dsn;
}

// ---------------------------------------------------------------------------
// Live state and its pure classification
// ---------------------------------------------------------------------------

export type OverrideRow = {
  id: number;
  entityType: string;
  entityKey: string;
  fieldGroup: string;
  overrideValues: unknown;
  isActive: boolean;
  adminUserId: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DataEditClaim = { id: number; tableName: string; fieldGroup: string };

export type AuditRow = { id: number; at: Date; actorUserId: number | null; action: string; detail: unknown };

export type ActorRow = { id: number; role: string; enabled: boolean; hasPassword: boolean; hasTotp: boolean };

export type FixtureState = {
  database: string;
  /** Every data_overrides row naming the fixture's match_key: `matches` exact, `match_coaches` by prefix. */
  overrides: OverrideRow[];
  /** `matches` rows carrying the fixture's match_key. Never looked up by the old id 17059. */
  canonicalMatches: number;
  /** `data_edits` rows whose note or values name ISSUE-109 or the fixture key. */
  dataEditClaims: DataEditClaim[];
  /** Every `auth_audit_log` row with action `database.promoted`. */
  promotionMarkers: AuditRow[];
  /** Every `auth_audit_log` row with action `data_override.retired`. */
  retirementAudits: AuditRow[];
  /** `auth_users` rows matching --actor-email case-insensitively. */
  actors: ActorRow[];
};

export type Issue246Classification =
  | { kind: 'RETIRE'; override: OverrideRow; actorId: number; markerIds: number[] }
  | { kind: 'ALREADY_RETIRED'; override: OverrideRow; auditId: number; markerIds: number[] }
  | { kind: 'STOP'; problems: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly `{ "notes": <baseline> }`: one key, the exact string, nothing else. */
export function isExactBaselinePayload(value: unknown): boolean {
  return isPlainObject(value)
    && Object.keys(value).length === 1
    && value.notes === ISSUE109_BASELINE_NOTES;
}

export function inProvenanceWindow(at: Date): boolean {
  const t = at.getTime();
  return Number.isFinite(t)
    && t >= Date.parse(ISSUE109_FIXTURE.provenanceFromIso)
    && t < Date.parse(ISSUE109_FIXTURE.provenanceToIso);
}

/**
 * A marker accounts for the missing ISSUE-109 audit chain only if a DEV promotion of afldb_dev,
 * AFTER the fixture's last ISSUE-109 write, declared `data_edits` historical-only. The generator
 * (promotion-inventory.ts `promotionAuditMarkerSql`) writes each entry as `<table> (<decidedBy>)`.
 */
export function isQualifyingPromotionMarker(marker: AuditRow, issue109LastWrite: Date): boolean {
  if (marker.action !== PROMOTION_MARKER_ACTION || !isPlainObject(marker.detail)) return false;
  const d = marker.detail;
  const historical = d.historical_only;
  return d.environment === ISSUE246_ENVIRONMENT
    && d.replaced === ISSUE246_TARGET_DATABASE
    && Array.isArray(historical)
    && historical.some((e) => typeof e === 'string' && (e === 'data_edits' || e.startsWith('data_edits (')))
    && marker.at.getTime() > issue109LastWrite.getTime();
}

/** A retirement audit concerns this fixture if it names it, or if it cannot be read at all. */
export function retirementAuditConcernsFixture(audit: AuditRow): boolean {
  if (!isPlainObject(audit.detail)) return true;
  return audit.detail.entity_key === ISSUE109_FIXTURE.entityKey || audit.detail.issue === ISSUE246;
}

/** Everything wrong with the one retirement audit of an already-retired override; empty = coherent. */
export function retirementAuditProblems(audit: AuditRow, override: OverrideRow): string[] {
  const where = `auth_audit_log ${audit.id}`;
  if (!isPlainObject(audit.detail)) return [`${where}: detail is not a JSON object`];
  const d = audit.detail;
  const problems: string[] = [];
  const prev = isPlainObject(d.previous_state) ? d.previous_state : null;
  const next = isPlainObject(d.new_state) ? d.new_state : null;
  if (d.issue !== ISSUE246) problems.push(`${where}: issue is not ${ISSUE246}`);
  if (d.operation !== RETIREMENT_OPERATION) problems.push(`${where}: operation is not ${RETIREMENT_OPERATION}`);
  if (d.override_id !== override.id) problems.push(`${where}: override_id is not ${override.id}`);
  if (d.entity_type !== ISSUE109_FIXTURE.entityType || d.entity_key !== ISSUE109_FIXTURE.entityKey
    || d.field_group !== ISSUE109_FIXTURE.fieldGroup) {
    problems.push(`${where}: natural key is not ${ISSUE109_FIXTURE.entityType}/${ISSUE109_FIXTURE.entityKey}/${ISSUE109_FIXTURE.fieldGroup}`);
  }
  if (prev?.is_active !== true) problems.push(`${where}: previous_state.is_active is not true`);
  if (next?.is_active !== false) problems.push(`${where}: new_state.is_active is not false`);
  if (!isExactBaselinePayload(d.preserved_override_values)) {
    problems.push(`${where}: preserved_override_values is not the exact ISSUE-109 baseline`);
  }
  const prevUpdated = typeof prev?.updated_at === 'string' ? new Date(prev.updated_at) : null;
  if (!prevUpdated || !inProvenanceWindow(prevUpdated)) {
    problems.push(`${where}: previous_state.updated_at is not within the ISSUE-109 provenance window`);
  }
  if (audit.actorUserId === null) problems.push(`${where}: no actor_user_id`);
  if (audit.at.getTime() !== override.updatedAt.getTime()) {
    problems.push(`${where}: at (${audit.at.toISOString()}) is not the override's updated_at `
      + `(${override.updatedAt.toISOString()}); the retirement and its audit were not one transaction`);
  }
  return problems;
}

function actorProblems(actors: readonly ActorRow[], email: string): { id: number | null; problems: string[] } {
  if (actors.length !== 1) {
    return { id: null, problems: [`--actor-email ${email} matches ${actors.length} auth_users row(s), not exactly 1`] };
  }
  const a = actors[0];
  const problems: string[] = [];
  if (a.role !== 'super_admin') problems.push(`actor auth_users ${a.id} has role '${a.role}', not 'super_admin'`);
  if (!a.enabled) problems.push(`actor auth_users ${a.id} is disabled`);
  if (!a.hasPassword || !a.hasTotp) problems.push(`actor auth_users ${a.id} is not fully enrolled (password and TOTP)`);
  return { id: a.id, problems };
}

/**
 * The whole guard. Pure: no I/O, so every refusal is DB-free testable. Any problem is a STOP
 * that lists every problem found; the caller throws, so the transaction rolls back unwritten.
 */
export function classifyIssue246State(state: FixtureState, actorEmail: string): Issue246Classification {
  if (state.database !== ISSUE246_TARGET_DATABASE) {
    return { kind: 'STOP', problems: [`current_database() is '${state.database}', not '${ISSUE246_TARGET_DATABASE}'`] };
  }
  if (state.overrides.length !== 1) {
    const listed = state.overrides.map((o) => `${o.id} ${o.entityType}/${o.fieldGroup}`).join(', ');
    return {
      kind: 'STOP',
      problems: [state.overrides.length === 0
        ? `no data_overrides row names ${ISSUE109_FIXTURE.entityKey}`
        : `${state.overrides.length} data_overrides rows name ${ISSUE109_FIXTURE.entityKey} (${listed}); exactly one is required`],
    };
  }
  const o = state.overrides[0];
  const problems: string[] = [];
  const at = `data_overrides ${o.id}`;
  if (o.entityType !== ISSUE109_FIXTURE.entityType || o.entityKey !== ISSUE109_FIXTURE.entityKey
    || o.fieldGroup !== ISSUE109_FIXTURE.fieldGroup) {
    problems.push(`${at} is ${o.entityType}/${o.entityKey}/${o.fieldGroup}, not the ISSUE-109 `
      + `${ISSUE109_FIXTURE.entityType}/${ISSUE109_FIXTURE.entityKey}/${ISSUE109_FIXTURE.fieldGroup}`);
  }
  if (o.id !== ISSUE109_FIXTURE.overrideId) problems.push(`${at}: id is not the recorded ${ISSUE109_FIXTURE.overrideId}`);
  if (!isExactBaselinePayload(o.overrideValues)) {
    problems.push(`${at}: override_values is not exactly {"notes": "${ISSUE109_BASELINE_NOTES}"}`);
  }
  if (o.adminUserId !== ISSUE109_FIXTURE.adminUserId) {
    problems.push(`${at}: admin_user_id is ${o.adminUserId}, not the ISSUE-109 author ${ISSUE109_FIXTURE.adminUserId}`);
  }
  if (!inProvenanceWindow(o.createdAt)) {
    problems.push(`${at}: created_at ${o.createdAt.toISOString()} is outside the ISSUE-109 2026-08-30 window`);
  }
  if (o.createdAt.getTime() > o.updatedAt.getTime()) problems.push(`${at}: created_at is after updated_at`);
  if (state.canonicalMatches !== 0) {
    problems.push(`canonical match ${ISSUE109_FIXTURE.entityKey} is PRESENT (${state.canonicalMatches} row(s)); `
      + 'the override is not orphaned, and retiring it would drop a live human decision');
  }
  if (state.dataEditClaims.length > 0) {
    problems.push(`data_edits holds ${state.dataEditClaims.length} row(s) naming ISSUE-109 or the fixture key `
      + `(${state.dataEditClaims.map((c) => `${c.id} ${c.tableName}/${c.fieldGroup}`).join(', ')}); `
      + 'the current lineage must hold no surviving ISSUE-109 audit chain');
  }

  const audits = state.retirementAudits.filter(retirementAuditConcernsFixture);
  let issue109LastWrite: Date | null = null;
  let auditId: number | null = null;
  if (o.isActive) {
    if (audits.length > 0) {
      problems.push(`${at} is active but ${audits.length} ${RETIREMENT_ACTION} audit(s) already name it `
        + `(${audits.map((a) => a.id).join(', ')}); inconsistent state`);
    }
    if (!inProvenanceWindow(o.updatedAt)) {
      problems.push(`${at}: updated_at ${o.updatedAt.toISOString()} is outside the ISSUE-109 2026-08-30 window; `
        + 'the override changed after ISSUE-109');
    } else {
      issue109LastWrite = o.updatedAt;
    }
  } else if (audits.length === 0) {
    problems.push(`${at} is already inactive but no ${RETIREMENT_ACTION} audit names it; it was deactivated `
      + 'outside this lifecycle');
  } else if (audits.length > 1) {
    problems.push(`${audits.length} ${RETIREMENT_ACTION} audits name the fixture (${audits.map((a) => a.id).join(', ')}); `
      + 'exactly one is allowed');
  } else {
    const auditProblems = retirementAuditProblems(audits[0], o);
    problems.push(...auditProblems);
    if (auditProblems.length === 0) {
      auditId = audits[0].id;
      issue109LastWrite = new Date(((audits[0].detail as Record<string, unknown>).previous_state as Record<string, string>).updated_at);
    }
  }

  const markerIds = issue109LastWrite
    ? state.promotionMarkers.filter((m) => isQualifyingPromotionMarker(m, issue109LastWrite)).map((m) => m.id)
    : [];
  if (issue109LastWrite && markerIds.length === 0) {
    problems.push(`no ${PROMOTION_MARKER_ACTION} marker (environment dev, replaced afldb_dev, historical_only `
      + `naming data_edits) is later than ${issue109LastWrite.toISOString()}; the ISSUE-109 audit chain's `
      + 'absence is unexplained');
  }

  if (o.isActive) {
    const actor = actorProblems(state.actors, actorEmail);
    problems.push(...actor.problems);
    if (problems.length > 0) return { kind: 'STOP', problems };
    return { kind: 'RETIRE', override: o, actorId: actor.id as number, markerIds };
  }
  if (problems.length > 0 || auditId === null) return { kind: 'STOP', problems };
  return { kind: 'ALREADY_RETIRED', override: o, auditId, markerIds };
}

/** The one retirement audit's detail. Natural key and override id, never a lineage-bound row id. */
export function buildRetirementAuditDetail(override: OverrideRow, markerIds: readonly number[]): Record<string, unknown> {
  return {
    issue: ISSUE246,
    operation: RETIREMENT_OPERATION,
    reason: 'AFLDB-ISSUE-237 L4 A4.3 STOP (matches=1): the retained AFLDB-ISSUE-109 DEV validation '
      + 'fixture override is orphaned (its canonical match is absent from afldb_dev), so a promotion '
      + 'replay would silently lose it. Retired, not deleted, by the ISSUE-246 audited lifecycle.',
    related_issues: ['AFLDB-ISSUE-109', 'AFLDB-ISSUE-237'],
    database: ISSUE246_TARGET_DATABASE,
    override_id: override.id,
    entity_type: override.entityType,
    entity_key: override.entityKey,
    field_group: override.fieldGroup,
    previous_state: {
      is_active: true,
      admin_user_id: override.adminUserId,
      created_at: override.createdAt.toISOString(),
      updated_at: override.updatedAt.toISOString(),
    },
    new_state: { is_active: false },
    preserved_override_values: expectedOverrideValues(),
    canonical_match_present: false,
    historical_provenance: {
      record: 'issues/closed/AFLDB-ISSUE-109.md, Final execution evidence (2026-08-30)',
      replaced_lineage_match_id: ISSUE109_FIXTURE.replacedLineageMatchId,
      replaced_lineage_audit_rows: [...ISSUE109_FIXTURE.replacedLineageAuditRows],
      current_lineage_audit: 'absent: data_edits was withheld as historical-only by a DEV promotion',
      promotion_marker_ids: [...markerIds],
    },
    tool: TOOL_PATH,
  };
}

// ---------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------

/** Every database operation, so the ordering and the rollback contract are DB-free testable. */
export interface Issue246Db {
  readState(actorEmail: string, lock: boolean): Promise<FixtureState>;
  readPrivileges(): Promise<{ canUpdateOverride: boolean; canInsertAudit: boolean }>;
  /** The guarded UPDATE; returns the number of rows it changed. */
  retireOverride(overrideId: number): Promise<number>;
  /** The one INSERT; returns the new auth_audit_log id. */
  insertRetirementAudit(actorId: number, detail: Record<string, unknown>): Promise<number>;
}

export type Issue246Outcome = {
  verdict: 'WOULD_RETIRE' | 'RETIRED' | 'ALREADY_RETIRED';
  overrideId: number;
  auditId: number | null;
  actorId: number | null;
  markerIds: number[];
  writes: number;
};

function stop(problems: readonly string[]): Issue246Refused {
  return new Issue246Refused(`STOP before mutation:\n      - ${problems.join('\n      - ')}`);
}

/**
 * Runs inside the caller's transaction and never catches: any throw propagates out of
 * `begin()`, which rolls the UPDATE and the INSERT back together.
 */
export async function executeIssue246(db: Issue246Db, args: Issue246Args): Promise<Issue246Outcome> {
  const before = classifyIssue246State(await db.readState(args.actorEmail, args.apply), args.actorEmail);
  if (before.kind === 'STOP') throw stop(before.problems);
  if (before.kind === 'ALREADY_RETIRED') {
    return {
      verdict: 'ALREADY_RETIRED', overrideId: before.override.id, auditId: before.auditId,
      actorId: null, markerIds: before.markerIds, writes: 0,
    };
  }
  if (!args.apply) {
    return {
      verdict: 'WOULD_RETIRE', overrideId: before.override.id, auditId: null,
      actorId: before.actorId, markerIds: before.markerIds, writes: 0,
    };
  }

  const privileges = await db.readPrivileges();
  const missing = [
    ...(privileges.canUpdateOverride ? [] : ['UPDATE data_overrides(is_active, updated_at)']),
    ...(privileges.canInsertAudit ? [] : ['INSERT auth_audit_log']),
  ];
  if (missing.length > 0) {
    throw new Issue246Refused(
      `The connected role lacks ${missing.join(' and ')}; ${ISSUE246_DSN_ENV} must be the afldb_dev `
      + 'owner DSN. Nothing was written.');
  }

  const changed = await db.retireOverride(before.override.id);
  if (changed !== 1) {
    throw new Issue246Refused(
      `The guarded UPDATE changed ${changed} row(s), not exactly 1; no audit was written. Rolled back.`);
  }
  const auditId = await db.insertRetirementAudit(
    before.actorId, buildRetirementAuditDetail(before.override, before.markerIds));

  const after = classifyIssue246State(await db.readState(args.actorEmail, false), args.actorEmail);
  if (after.kind !== 'ALREADY_RETIRED' || after.auditId !== auditId) {
    throw new Issue246Refused(
      `Post-write readback is not the retired state bound to audit ${auditId}`
      + `${after.kind === 'STOP' ? `: ${after.problems.join('; ')}` : ` (${after.kind})`}. Rolled back.`);
  }
  return {
    verdict: 'RETIRED', overrideId: before.override.id, auditId,
    actorId: before.actorId, markerIds: before.markerIds, writes: 2,
  };
}

const KEY = ISSUE109_FIXTURE.entityKey;

/** The real statements. int8 ids are cast to int (postgres.js returns int8 as a string). */
export function postgresIssue246Db(tx: TransactionSql): Issue246Db {
  return {
    async readState(actorEmail, lock) {
      const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
      const overrides = lock
        ? await tx<OverrideRow[]>`
            SELECT id::int AS id, entity_type AS "entityType", entity_key AS "entityKey",
                   field_group AS "fieldGroup", override_values AS "overrideValues",
                   is_active AS "isActive", admin_user_id AS "adminUserId",
                   created_at AS "createdAt", updated_at AS "updatedAt"
              FROM data_overrides
             WHERE (entity_type = 'matches' AND entity_key = ${KEY})
                OR (entity_type = 'match_coaches' AND starts_with(entity_key, ${`${KEY}|`}))
             ORDER BY id
               FOR UPDATE`
        : await tx<OverrideRow[]>`
            SELECT id::int AS id, entity_type AS "entityType", entity_key AS "entityKey",
                   field_group AS "fieldGroup", override_values AS "overrideValues",
                   is_active AS "isActive", admin_user_id AS "adminUserId",
                   created_at AS "createdAt", updated_at AS "updatedAt"
              FROM data_overrides
             WHERE (entity_type = 'matches' AND entity_key = ${KEY})
                OR (entity_type = 'match_coaches' AND starts_with(entity_key, ${`${KEY}|`}))
             ORDER BY id`;
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches WHERE match_key = ${KEY}`;
      const dataEditClaims = await tx<DataEditClaim[]>`
        SELECT id::int AS id, table_name AS "tableName", field_group AS "fieldGroup"
          FROM data_edits
         WHERE strpos(coalesce(note, ''), 'AFLDB-ISSUE-109') > 0
            OR strpos(old_values::text, 'AFLDB-ISSUE-109') > 0
            OR strpos(new_values::text, 'AFLDB-ISSUE-109') > 0
            OR strpos(old_values::text, ${KEY}) > 0
            OR strpos(new_values::text, ${KEY}) > 0
         ORDER BY id`;
      const promotionMarkers = await tx<AuditRow[]>`
        SELECT id::int AS id, at, actor_user_id AS "actorUserId", action, detail
          FROM auth_audit_log WHERE action = ${PROMOTION_MARKER_ACTION} ORDER BY id`;
      const retirementAudits = await tx<AuditRow[]>`
        SELECT id::int AS id, at, actor_user_id AS "actorUserId", action, detail
          FROM auth_audit_log WHERE action = ${RETIREMENT_ACTION} ORDER BY id`;
      const actors = await tx<ActorRow[]>`
        SELECT id, role, disabled_at IS NULL AS enabled,
               password_hash IS NOT NULL AS "hasPassword", totp_secret IS NOT NULL AS "hasTotp"
          FROM auth_users WHERE lower(email) = ${actorEmail} ORDER BY id`;
      return {
        database, overrides: [...overrides], canonicalMatches: n, dataEditClaims: [...dataEditClaims],
        promotionMarkers: [...promotionMarkers], retirementAudits: [...retirementAudits], actors: [...actors],
      };
    },
    async readPrivileges() {
      const [row] = await tx<{ canUpdateOverride: boolean; canInsertAudit: boolean }[]>`
        SELECT has_column_privilege('data_overrides', 'is_active', 'UPDATE')
                 AND has_column_privilege('data_overrides', 'updated_at', 'UPDATE') AS "canUpdateOverride",
               has_table_privilege('auth_audit_log', 'INSERT') AS "canInsertAudit"`;
      return row;
    },
    async retireOverride(overrideId) {
      const rows = await tx<{ id: number }[]>`
        UPDATE data_overrides
           SET is_active = false,
               updated_at = now()
         WHERE id = ${overrideId}
           AND entity_type = ${ISSUE109_FIXTURE.entityType}
           AND entity_key = ${KEY}
           AND field_group = ${ISSUE109_FIXTURE.fieldGroup}
           AND admin_user_id = ${ISSUE109_FIXTURE.adminUserId}
           AND is_active = true
           AND override_values = ${tx.json(expectedOverrideValues())}
        RETURNING id::int AS id`;
      return rows.length;
    },
    async insertRetirementAudit(actorId, detail) {
      // sql.json() only: a pre-stringified value would be double-encoded (migration 082).
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail)
        VALUES (${actorId}, ${RETIREMENT_ACTOR_LABEL}, ${RETIREMENT_ACTION},
                ${tx.json(detail as postgres.JSONValue)})
        RETURNING id::int AS id`;
      return row.id;
    },
  };
}

export function formatIssue246Report(args: Issue246Args, outcome: Issue246Outcome): string {
  const pad = (label: string) => label.padEnd(20);
  const transaction = !args.apply
    ? 'READ ONLY (validate only; nothing written)'
    : outcome.writes === 0 ? 'COMMITTED (no writes)' : 'COMMITTED';
  return [
    `AFLDB ${ISSUE246} retire the ISSUE-109 DEV fixture override`,
    '',
    `${pad('target database')}: ${ISSUE246_TARGET_DATABASE}`,
    `${pad('override')}: data_overrides ${outcome.overrideId}`,
    `${pad('natural key')}: ${ISSUE109_FIXTURE.entityType} / ${ISSUE109_FIXTURE.entityKey} / ${ISSUE109_FIXTURE.fieldGroup}`,
    `${pad('canonical match')}: absent`,
    `${pad('promotion markers')}: ${outcome.markerIds.join(', ')}`,
    `${pad('actor auth_users id')}: ${outcome.actorId ?? '-'}`,
    '',
    `${pad('verdict')}: ${outcome.verdict}`,
    `${pad('retirement audit')}: ${outcome.auditId === null ? '-' : `auth_audit_log ${outcome.auditId}`}`,
    `${pad('writes')}: ${outcome.writes}`,
    `${pad('transaction')}: ${transaction}`,
    'PASS',
  ].join('\n');
}

export type Issue246Connection = {
  begin: <T>(mode: 'read only' | 'read write', fn: (tx: TransactionSql) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
};

/** Everything up to the report; `connect` and `makeDb` are injected so the whole path is DB-free testable. */
export async function runIssue246(input: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  connect: (dsn: string) => Issue246Connection;
  makeDb?: (tx: TransactionSql) => Issue246Db;
}): Promise<string> {
  // Every argv/env refusal happens BEFORE any connection is opened.
  const args = parseIssue246Args(input.argv);
  const dsn = resolveIssue246Dsn(input.env);
  const makeDb = input.makeDb ?? postgresIssue246Db;
  const sql = input.connect(dsn);
  try {
    const outcome = await sql.begin(args.apply ? 'read write' : 'read only', (tx) => executeIssue246(makeDb(tx), args));
    return formatIssue246Report(args, outcome);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && /issue246-retire-issue109-fixture\.ts$/.test(process.argv[1])) {
  runIssue246({
    argv: process.argv.slice(2),
    env: process.env,
    connect: (dsn) => {
      const sql = postgres(dsn, {
        max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue246-retire-fixture' },
      });
      return {
        begin: <T>(mode: 'read only' | 'read write', fn: (tx: TransactionSql) => Promise<T>) =>
          sql.begin(mode, fn) as Promise<T>,
        end: () => sql.end(),
      };
    },
  })
    .then((report) => {
      console.log(report);
      process.exit(0);
    })
    .catch((error) => {
      // Refusal text names variables and database names, never a DSN; a driver error is
      // redacted in case one ever quotes a connection string.
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      console.error('    FAIL (transaction ROLLED BACK or never opened; nothing written)');
      process.exit(1);
    });
}
