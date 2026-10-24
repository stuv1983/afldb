/**
 * AFLDB-ISSUE-316 C2 — successor ACTIVATION, separated from the rollover apply.
 *
 * WHY. Owner ruling (2026-10-25): the production apply and successor activation are separate owner
 * decisions. The apply must be able to complete, and be validated, with the successor still inactive;
 * activation must be one explicit, durable, inspectable and reversible state change, bound to the exact
 * production candidate, that reruns no migration, rebuild, census or rollover logic.
 *
 * THE ACTIVATION STATE is the existing closed successor table, `SUCCESSOR_LADDER_TUPLES_JSON` in
 * tools/db/rebuild-test.ts, and nothing else. The rebuild accepts a successor profile only when that table
 * lists its tuple (`resolveLadderRebuildExpectation`); the contract's `rebuild_expectation` names the
 * profile, but by the existing design a name grants nothing. The states:
 *
 *   A  pre-apply           predecessor documents; the table does not list the profile.
 *   B  applied, inactive   every file the change set pins holds its pinned bytes; rebuild-test.ts is
 *                          byte-identical to before the apply (`rebuild_sha256.inactive`), so every rebuild
 *                          refuses the installed profile.
 *   C  activated           B's files unchanged; rebuild-test.ts is B's bytes plus exactly the bound tuple
 *                          (`rebuild_sha256.active`): the one line the J2-proven transition wrote.
 *   D  deactivated         C reversed by `deactivate`: rebuild-test.ts back to `rebuild_sha256.inactive`,
 *                          which is B again. The rollover files are not touched; reversing the APPLY is its
 *                          own recovery route and is never performed here.
 *
 * BINDING. An authority names its action, the owner decision, the season, profile and rollover date, the
 * production source commit and the reviewed HEAD it is made on, the SHA-256 of the pinned change set, the
 * tuple's SHA-256, the migration set the code expects, and both rebuild-test.ts pins. Anything that differs
 * refuses. There is no "activate whatever successor is present".
 *
 * A SECOND ACTIVATION REFUSES (it is never a silent no-op), and so does deactivating an inactive state, so
 * every accepted invocation changes exactly one file from one pinned state to the other.
 *
 * Pure: the CLI reads files and asks Git; this module judges bytes.
 */
import { createHash } from 'node:crypto';

import { AFLTABLES_NETWORK_PATH } from './afltables-network-retirement';
import {
  LadderSuccessorRefused,
  planSuccessorTuplesEdit,
  planSuccessorTuplesRemoval,
  readSuccessorLadderTuplesJson,
  parseSuccessorLadderTuples,
  successorTupleSha256,
  type SuccessorLadderTuple,
} from './ladder-successor';
import {
  REBUILD_PATH,
  REGISTER_PATH,
  RolloverRefused,
  type SuccessorActivationProjection,
} from './season-rollover';
import {
  ACTIVATION_STAGING_PATH,
  assertNoSentinel,
  parseTransitionChangeSet,
  pendingTransactionProblem,
  sha256Hex,
  type FileIo,
  type TransitionChangeSet,
} from './transition-change-set';

export const ACTIVATION_SCHEMA = 'afldb.rollover.successor_activation/1';
/** The one file an activation or deactivation writes. */
export const ACTIVATION_PATH = REBUILD_PATH;
/** Shared with the rollover's leftover scan (`pendingTransactionProblem`), which also refuses on it. */
export { ACTIVATION_STAGING_PATH };
export const MIGRATIONS_DIR = 'src/db/migrations';

type Json = Record<string, unknown>;

function refuse(message: string): never {
  throw new RolloverRefused(message);
}

/** Refusals from the pure ladder module, reported as this tool's own. */
function ladder<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof LadderSuccessorRefused) refuse(error.message);
    throw error;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECISION = /^D-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const MIGRATION_NAME = /^\d{3,}_[A-Za-z0-9_-]+\.sql$/;

export type ActivationAction = 'activate' | 'deactivate';

export type MigrationSetState = { count: number; last: string; setSha256: string };

export type ActivationAuthority = {
  action: ActivationAction;
  decision: string;
  season: number;
  profile: string;
  rolloverDate: string;
  sourceCommit: string;
  headCommit: string;
  changeSetSha256: string;
  tupleSha256: string;
  migrations: MigrationSetState;
  rebuildSha256: { inactive: string; active: string };
};

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse(`${what} must be a JSON object.`);
  return value as Json;
}

function exactKeys(value: Json, keys: readonly string[], what: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) refuse(`${what} has the unknown field ${JSON.stringify(key)}.`);
  for (const key of keys) if (!(key in value)) refuse(`${what} is missing ${JSON.stringify(key)}.`);
}

function matching(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) refuse(`${what} is malformed (got ${JSON.stringify(value)}).`);
  return value;
}

/** Parse an activation authority. Strict: exact fields, exact shapes, no unresolved-proposal marker. */
export function parseActivationAuthority(text: string): ActivationAuthority {
  assertNoSentinel(text, 'The successor activation authority');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    refuse(`The successor activation authority is not valid JSON: ${String(error)}`);
  }
  const o = asObject(doc, 'The successor activation authority');
  exactKeys(o, ['schema', 'action', 'decision', 'season', 'profile', 'rollover_date', 'source_commit', 'head_commit',
    'transition_change_set_sha256', 'tuple_sha256', 'migrations', 'rebuild_sha256'], 'The successor activation authority');
  if (o.schema !== ACTIVATION_SCHEMA) refuse(`The activation authority schema is ${JSON.stringify(o.schema)}, not ${ACTIVATION_SCHEMA}.`);
  if (o.action !== 'activate' && o.action !== 'deactivate') {
    refuse(`The activation authority action must be "activate" or "deactivate" (got ${JSON.stringify(o.action)}).`);
  }
  if (typeof o.season !== 'number' || !Number.isInteger(o.season)) refuse('The activation authority season must be an integer.');
  const rolloverDate = matching(o.rollover_date, ISO_DATE, 'rollover_date');
  const day = new Date(`${rolloverDate}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== rolloverDate) {
    refuse(`rollover_date ${rolloverDate} is not a calendar date.`);
  }
  const migrations = asObject(o.migrations, 'migrations');
  exactKeys(migrations, ['count', 'last', 'set_sha256'], 'migrations');
  if (typeof migrations.count !== 'number' || !Number.isSafeInteger(migrations.count) || migrations.count <= 0) {
    refuse('migrations.count must be a positive integer.');
  }
  const rebuild = asObject(o.rebuild_sha256, 'rebuild_sha256');
  exactKeys(rebuild, ['inactive', 'active'], 'rebuild_sha256');
  const inactive = matching(rebuild.inactive, HEX64, 'rebuild_sha256.inactive');
  const active = matching(rebuild.active, HEX64, 'rebuild_sha256.active');
  if (inactive === active) refuse('rebuild_sha256.inactive and .active are the same bytes; an activation must change the table.');
  return {
    action: o.action as ActivationAction,
    decision: matching(o.decision, DECISION, 'decision'),
    season: o.season as number,
    profile: matching(o.profile, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/, 'profile'),
    rolloverDate,
    sourceCommit: matching(o.source_commit, COMMIT, 'source_commit'),
    headCommit: matching(o.head_commit, COMMIT, 'head_commit'),
    changeSetSha256: matching(o.transition_change_set_sha256, HEX64, 'transition_change_set_sha256'),
    tupleSha256: matching(o.tuple_sha256, HEX64, 'tuple_sha256'),
    migrations: {
      count: migrations.count as number,
      last: matching(migrations.last, MIGRATION_NAME, 'migrations.last'),
      setSha256: matching(migrations.set_sha256, HEX64, 'migrations.set_sha256'),
    },
    rebuildSha256: { inactive, active },
  };
}

/**
 * The migration set the code expects, from the migration files alone: their count, the last name, and the
 * SHA-256 of `name<TAB>sha256(LF-normalised text)<LF>` per file in name order (line-ending independent, as the
 * migration ledger's own checksum comparison is). Production's applied ledger is the release preflight's to
 * verify; this binds the code being activated to the schema it was reviewed against.
 */
export function migrationSetState(files: ReadonlyArray<{ name: string; text: string }>): MigrationSetState {
  if (files.length === 0) refuse(`${MIGRATIONS_DIR} holds no migration.`);
  const names = files.map((f) => f.name);
  for (const name of names) if (!MIGRATION_NAME.test(name)) refuse(`${MIGRATIONS_DIR}/${name} is not a migration file name.`);
  if (new Set(names).size !== names.length) refuse(`${MIGRATIONS_DIR} lists a migration twice.`);
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const lines = sorted.map((f) => `${f.name}\t${createHash('sha256').update(f.text.replace(/\r\n/g, '\n'), 'utf8').digest('hex')}\n`);
  return { count: sorted.length, last: sorted[sorted.length - 1].name, setSha256: sha256Hex(lines.join('')) };
}

/**
 * Bind the change set and its tuple to the authority. The change set must be the pinned one (its whole bytes),
 * for this season, carrying exactly the authority's tuple, pinned for apply, and must not name rebuild-test.ts:
 * an apply that wrote the activation file is not one this tool will activate on top of.
 */
export function bindActivationChangeSet(authority: ActivationAuthority, changeSetBytes: Buffer): {
  changeSet: TransitionChangeSet; tuple: SuccessorLadderTuple;
} {
  if (sha256Hex(changeSetBytes) !== authority.changeSetSha256) {
    refuse(`The transition change set is not the one this authority binds (SHA-256 ${sha256Hex(changeSetBytes)}, `
      + `authority ${authority.changeSetSha256}).`);
  }
  const changeSet = parseTransitionChangeSet(changeSetBytes.toString('utf8'));
  if (changeSet.season !== authority.season) {
    refuse(`The change set is for season ${changeSet.season}, but the authority names ${authority.season}.`);
  }
  const tuple = changeSet.successorLadderTuple;
  if (tuple === null) refuse('The bound change set carries no ladder_successor_tuple, so there is nothing to activate.');
  if (tuple.profile !== authority.profile) {
    refuse(`The change set's successor profile is ${JSON.stringify(tuple.profile)}, but the authority names `
      + `${JSON.stringify(authority.profile)}.`);
  }
  const digest = successorTupleSha256(tuple);
  if (digest !== authority.tupleSha256) {
    refuse(`The change set's successor tuple hashes to ${digest}, but the authority binds ${authority.tupleSha256}.`);
  }
  if (changeSet.finalSha256 === null) refuse('The bound change set has no final_sha256: it is not a pinned apply change set.');
  if (changeSet.writeSet.includes(ACTIVATION_PATH) || Object.hasOwn(changeSet.finalSha256, ACTIVATION_PATH)) {
    refuse(`The bound change set names ${ACTIVATION_PATH}; a successor apply never writes it, so this change set `
      + 'predates the separated activation and cannot be activated on top of.');
  }
  return { changeSet, tuple };
}

/** HEAD must be the reviewed commit the authority names, and the production source commit must be its ancestor. */
export function assertCommitBinding(authority: ActivationAuthority, git: { head: string; sourceIsAncestor: boolean }): void {
  if (git.head !== authority.headCommit) {
    refuse(`HEAD is ${git.head}, but the authority is bound to ${authority.headCommit}.`);
  }
  if (!git.sourceIsAncestor) {
    refuse(`The production source commit ${authority.sourceCommit} is not an ancestor of HEAD ${git.head}.`);
  }
}

export function assertMigrationBinding(authority: ActivationAuthority, actual: MigrationSetState): void {
  const want = authority.migrations;
  if (actual.count !== want.count || actual.last !== want.last || actual.setSha256 !== want.setSha256) {
    refuse(`The migration set is ${actual.count} files ending ${actual.last} (${actual.setSha256}), but the `
      + `authority binds ${want.count} ending ${want.last} (${want.setSha256}).`);
  }
}

export type ActivationState = 'applied-inactive' | 'activated';

export type ClassifiedState = {
  state: ActivationState;
  /** Current rebuild-test.ts text. */
  current: string;
  /** rebuild-test.ts in the inactive (B/D) state. */
  inactiveText: string;
  /** rebuild-test.ts in the activated (C) state. */
  activeText: string;
};

function parseJson(bytes: Buffer, what: string): Json {
  try {
    return asObject(JSON.parse(bytes.toString('utf8')), what);
  } catch (error) {
    if (error instanceof RolloverRefused) throw error;
    refuse(`${what} is not valid JSON.`);
  }
}

/**
 * Which state the working tree is in, judged only from bytes. Refuses unless every file the change set pins
 * holds its pinned bytes (the applied state, so A, a partial apply or any drift refuses), the applied register
 * and AFL Tables switch carry the authority's rollover date and the tuple's core, and rebuild-test.ts is
 * exactly one of the two pinned states, with each pin re-derived from the other by the reviewed one-line edit.
 */
export function classifyActivationState(input: {
  authority: ActivationAuthority;
  changeSet: TransitionChangeSet;
  tuple: SuccessorLadderTuple;
  readRepo: (path: string) => Buffer | null;
}): ClassifiedState {
  const { authority, changeSet, tuple, readRepo } = input;
  const pins = changeSet.finalSha256!;
  const drift: string[] = [];
  for (const [path, pin] of Object.entries(pins)) {
    const bytes = readRepo(path);
    const now = bytes === null ? 'absent' : sha256Hex(bytes);
    if (now !== pin) drift.push(`${path} holds ${now}, pinned ${pin}`);
  }
  if (drift.length > 0) {
    refuse('The working tree is not the applied state of the bound change set, so there is no installed, '
      + `inactive successor to act on: ${drift.join('; ')}. Activation requires exactly state B (applied, inactive).`);
  }

  const register = parseJson(readRepo(REGISTER_PATH) ?? Buffer.from(''), REGISTER_PATH);
  const accepted = (Array.isArray(register.baselines) ? register.baselines as Json[] : [])
    .filter((b) => b.acceptance_status === 'accepted');
  if (accepted.length !== 1 || accepted[0].snapshot_label !== tuple.core_snapshot_label
      || accepted[0].accepted_on !== authority.rolloverDate) {
    refuse(`The applied register does not accept exactly ${JSON.stringify(tuple.core_snapshot_label)} on `
      + `${authority.rolloverDate}; the authority is bound to another rollover.`);
  }
  const network = parseJson(readRepo(AFLTABLES_NETWORK_PATH) ?? Buffer.from(''), AFLTABLES_NETWORK_PATH);
  if (network.status !== 'retired' || network.changed_at !== authority.rolloverDate) {
    refuse(`${AFLTABLES_NETWORK_PATH} is not retired on ${authority.rolloverDate}; the authority is bound to another rollover.`);
  }

  const bytes = readRepo(ACTIVATION_PATH);
  if (bytes === null) refuse(`${ACTIVATION_PATH} does not exist.`);
  const current = bytes.toString('utf8');
  if (!Buffer.from(current, 'utf8').equals(bytes)) refuse(`${ACTIVATION_PATH} is not valid UTF-8.`);
  const now = sha256Hex(bytes);
  const { inactive, active } = authority.rebuildSha256;
  if (now === inactive) {
    const activeText = ladder(() => planSuccessorTuplesEdit(current, tuple));
    if (sha256Hex(activeText) !== active) {
      refuse(`Appending the bound tuple to the inactive ${ACTIVATION_PATH} gives ${sha256Hex(activeText)}, not the `
        + `authority's active pin ${active}.`);
    }
    return { state: 'applied-inactive', current, inactiveText: current, activeText };
  }
  if (now === active) {
    const inactiveText = ladder(() => planSuccessorTuplesRemoval(current, tuple));
    if (sha256Hex(inactiveText) !== inactive) {
      refuse(`Removing the bound tuple from the active ${ACTIVATION_PATH} gives ${sha256Hex(inactiveText)}, not the `
        + `authority's inactive pin ${inactive}.`);
    }
    return { state: 'activated', current, inactiveText, activeText: current };
  }
  refuse(`${ACTIVATION_PATH} holds ${now}, which is neither the authority's inactive pin ${inactive} nor its `
    + `active pin ${active}.`);
}

export type ActivationWrite = { path: string; before: string; after: string; from: ActivationState; to: ActivationState };

/** The one write an accepted invocation makes. A repeated activation or deactivation refuses; nothing is a no-op. */
export function planActivationWrite(action: ActivationAction, classified: ClassifiedState): ActivationWrite {
  if (action === 'activate') {
    if (classified.state === 'activated') {
      refuse(`The successor is ALREADY ACTIVE (${ACTIVATION_PATH} holds the active pin). A second activation is `
        + 'refused, never a silent no-op; nothing was written.');
    }
    return { path: ACTIVATION_PATH, before: classified.current, after: classified.activeText, from: 'applied-inactive', to: 'activated' };
  }
  if (classified.state === 'applied-inactive') {
    refuse(`The successor is ALREADY INACTIVE (${ACTIVATION_PATH} holds the inactive pin). Deactivation is refused; `
      + 'nothing was written.');
  }
  return { path: ACTIVATION_PATH, before: classified.current, after: classified.inactiveText, from: 'activated', to: 'applied-inactive' };
}

/** What an earlier rollover apply or activation left unfinished, or null. Checked before anything is judged. */
export function activationPendingProblem(io: FileIo): string[] | null {
  if (io.read(ACTIVATION_STAGING_PATH) !== null) {
    return [`A staged activation file remains: ${ACTIVATION_STAGING_PATH}. ${ACTIVATION_PATH} was not replaced by it; `
      + 'delete it and re-run from the dry run.'];
  }
  return pendingTransactionProblem(io);
}

/**
 * Stage, read back, re-check, rename, read back. One file, so the rename is the whole change; `recheck`
 * re-judges the complete binding immediately before the rename so a change after the verdict refuses.
 */
export function applyActivationWrite(io: FileIo, write: ActivationWrite, recheck: () => void): void {
  if (io.read(ACTIVATION_STAGING_PATH) !== null) refuse(`${ACTIVATION_STAGING_PATH} already exists; nothing was written.`);
  try {
    io.write(ACTIVATION_STAGING_PATH, write.after);
    const back = io.read(ACTIVATION_STAGING_PATH);
    if (back === null || sha256Hex(back) !== sha256Hex(write.after)) {
      refuse(`Staging ${write.path} did not read back the planned bytes; nothing was replaced.`);
    }
    recheck();
    const now = io.read(write.path);
    if (now === null || sha256Hex(now) !== sha256Hex(write.before)) {
      refuse(`${write.path} changed after it was judged; nothing was replaced. Re-run from the dry run.`);
    }
  } catch (error) {
    try { io.remove(ACTIVATION_STAGING_PATH); } catch { /* reported as a leftover on the next invocation */ }
    throw error;
  }
  io.rename(ACTIVATION_STAGING_PATH, write.path);
  const landed = io.read(write.path);
  if (landed === null || sha256Hex(landed) !== sha256Hex(write.after)) {
    refuse(`Post-write verification failed for ${write.path}: it does not hold ${sha256Hex(write.after)}. Restore it `
      + `to ${sha256Hex(write.before)} (git checkout -- ${write.path}) before anything else.`);
  }
}

/**
 * Apply-time proof that the apply leaves the successor INACTIVE: the rebuild source the proposed state reads is
 * the unchanged current one, its table does not list the profile, and the projected activation is exactly the
 * reviewed one-line append of the tuple to those bytes.
 */
export function assertInactiveApplyState(currentRebuild: string, projection: SuccessorActivationProjection): void {
  if (currentRebuild !== projection.inactiveContent) {
    refuse(`${projection.path} changed between planning and validation; nothing was written. Re-run the dry run.`);
  }
  const table = ladder(() => parseSuccessorLadderTuples(readSuccessorLadderTuplesJson(currentRebuild)));
  if (Object.hasOwn(table, projection.tuple.profile)) {
    refuse(`${projection.path} already lists ${JSON.stringify(projection.tuple.profile)}: the successor is active `
      + 'before the apply.');
  }
  if (ladder(() => planSuccessorTuplesEdit(currentRebuild, projection.tuple)) !== projection.activeContent) {
    refuse('The projected activation is not the reviewed one-line append of the tuple.');
  }
}

/** The pins an activation authority needs, printed by the rollover dry run. Informational: nothing is written. */
export function formatActivationProjection(projection: SuccessorActivationProjection): string[] {
  const literal = (text: string) => ladder(() => readSuccessorLadderTuplesJson(text));
  return [
    `profile                 ${projection.tuple.profile}`,
    `file                    ${projection.path} (not in this write set; left byte-identical)`,
    `tuple_sha256            ${successorTupleSha256(projection.tuple)}`,
    `rebuild_sha256.inactive ${sha256Hex(projection.inactiveContent)}`,
    `rebuild_sha256.active   ${sha256Hex(projection.activeContent)}`,
    `table before            '${literal(projection.inactiveContent)}'`,
    `table after activation  '${literal(projection.activeContent)}'`,
    'Validated above as the ACTIVATED state; the apply itself leaves the profile unresolvable (inactive).',
  ];
}
