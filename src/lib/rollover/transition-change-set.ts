/**
 * AFLDB-ISSUE-316 C2 — the rollover transition as ONE validated change set.
 *
 * WHY. The rollover planner derives the successor contract from the current contract, so every
 * contract edit it cannot compute (continuity, height, ladder-expectation and measurement blocks,
 * the other two contracts' measured counts) used to have to sit in the working tree BEFORE the dry
 * run. That made the selected predecessor invalid for the whole review and gate window and
 * left no single artefact naming what would change. This module lets the existing CLI carry the
 * complete transition instead: the operator-reviewed change set states every file the apply will
 * write, the exact bytes each replaces, and (for apply) the hash of every byte it will write, and
 * nothing reaches the working tree until the planner's own gates have passed against all of it.
 *
 * WHAT IT DOES NOT DO. It is not a second rollover procedure and relaxes no gate: the date,
 * retirement-status, ownership-census, owner-decision and validator checks in `season-rollover.ts`
 * and `afltables-network-retirement.ts` run unchanged, on every dry run and apply. Text it carries
 * is never authority: a change set, proposed file or planned output containing the proposal
 * sentinel `UNRESOLVED:` is refused outright, so an unfilled owner field can never be read as a
 * value. Files the planner owns (register, seasons, stat-availability, the stage-9 constant, the
 * AFL Tables switch) cannot be supplied as replacements; the contract may only enter as a BASE the
 * planner derives from, and only with the planner's own read/written fields left untouched.
 *
 * Pure: the CLI reads and writes files; this module only judges bytes and builds the journal.
 */
import { createHash } from 'node:crypto';

import {
  CONTRACT_PATH,
  REBUILD_PATH,
  REGISTER_PATH,
  RolloverRefused,
  SEASONS_PATH,
  STAT_AVAILABILITY_PATH,
  parseJsonPointer,
  type PlannedFile,
  type RegisterPatch,
  type TransitionInput,
} from './season-rollover';
import { AFLTABLES_NETWORK_PATH } from './afltables-network-retirement';

type Json = Record<string, unknown>;

export const TRANSITION_SCHEMA = 'afldb.rollover.transition_change_set/1';
export const TRANSITION_FLAG = '--transition-change-set';
export const TRANSACTION_JOURNAL_PATH = '.rollover-transaction.json';
export const TRANSACTION_JOURNAL_SCHEMA = 'afldb.rollover.transaction_journal/1';
export const STAGING_SUFFIX = '.rollover-tmp';
/** The proposal's marker for an owner-supplied, gate-produced or implementation-blocked field. */
export const SENTINEL_MARKER = 'UNRESOLVED:';

/** The only contract a change set may supply as the base the planner derives from. */
export const TRANSITION_BASE_PATH = CONTRACT_PATH;
/** Contracts the planner never touches; a change set may replace them whole. Closed list. */
export const TRANSITION_REPLACEABLE_PATHS: readonly string[] = [
  'tools/rebuild/afl_api/afl-api-contract.json',
  'tools/rebuild/afltables/afltables-contract.json',
];
/** Every file the planner itself writes, in the CLI's own order of authority. */
export const PLANNER_OWNED_WRITES: readonly string[] = [
  AFLTABLES_NETWORK_PATH, REGISTER_PATH, SEASONS_PATH, CONTRACT_PATH, STAT_AVAILABILITY_PATH,
  REBUILD_PATH,
];
export const INPUT_ROLES = [
  'core_manifest', 'ladder_manifest', 'ladder_coverage', 'stat_availability', 'accepted_corrections',
] as const;
export type InputRole = (typeof INPUT_ROLES)[number];

/**
 * Contract fields the planner reads or writes. A base must leave them byte-for-value equal to
 * the current contract: the planner overwrites the written ones, so an edit there would be
 * silently dropped, and an edit to a read one would change what the planner believes it started
 * from.
 */
const PLANNER_BOUND_POINTERS: readonly string[] = [
  '/contract_version', '/pinned_version',
  '/full_history/contract_full_history_version', '/full_history/required_datasets',
  '/full_history/season_range/first_season', '/full_history/season_range/last_season',
  '/full_history/season_range/last_season_rule', '/full_history/season_range/resolved_on',
  '/full_history/current_season_excluded/seasons',
  '/datasets/ladder/accepted_witness/snapshot_label', '/datasets/ladder/accepted_witness/manifest',
  '/datasets/ladder/accepted_witness/manifest_sha256', '/datasets/ladder/accepted_witness/files',
  '/datasets/ladder/accepted_witness/rows', '/datasets/ladder/accepted_witness/acquired_on',
  '/datasets/ladder/accepted_witness/validator', '/datasets/ladder/coverage',
];

function refuse(message: string): never {
  throw new RolloverRefused(message);
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const HEX64 = /^[0-9a-f]{64}$/;

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${what} must be a JSON object.`);
  }
  return value as Json;
}

function exactKeys(value: Json, keys: readonly string[], what: string, optional: readonly string[] = []): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optional.includes(key)) refuse(`${what} has the unknown field ${JSON.stringify(key)}.`);
  }
  for (const key of keys) {
    if (!(key in value)) refuse(`${what} is missing ${JSON.stringify(key)}.`);
  }
}

function hex(value: unknown, what: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) refuse(`${what} must be a lower-case SHA-256 (64 hex).`);
  return value;
}

function repoPath(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.startsWith('/')
      || value.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    refuse(`${what} must be a normalised repository-relative path with '/' separators.`);
  }
  return value;
}

/** Refuse any text carrying the proposal sentinel. Applied to every byte this module is handed. */
export function assertNoSentinel(text: string, what: string): void {
  const at = text.indexOf(SENTINEL_MARKER);
  if (at >= 0) {
    const line = text.slice(0, at).split('\n').length;
    refuse(`${what} still contains the unresolved-proposal marker ${SENTINEL_MARKER} (line ${line}: `
      + `${JSON.stringify(text.slice(at, at + 60))}). A sentinel marks an owner-supplied, `
      + 'gate-produced or implementation-blocked value that has not been decided; it is never read '
      + 'as authority or as a value, so the whole change set is refused.');
  }
}

export type TransitionFileRef = {
  path: string; oldSha256: string; proposedPath: string; proposedSha256: string;
};

export type TransitionChangeSet = {
  season: number;
  inputs: Array<{ role: InputRole; path: string; sha256: string }>;
  base: TransitionFileRef | null;
  replace: TransitionFileRef[];
  registerPatches: RegisterPatch[];
  writeSet: string[];
  finalSha256: Record<string, string> | null;
};

function fileRef(value: unknown, what: string): TransitionFileRef {
  const o = asObject(value, what);
  exactKeys(o, ['path', 'old_sha256', 'proposed', 'proposed_sha256'], what);
  return {
    path: repoPath(o.path, `${what}.path`),
    oldSha256: hex(o.old_sha256, `${what}.old_sha256`),
    proposedPath: repoPath(o.proposed, `${what}.proposed`),
    proposedSha256: hex(o.proposed_sha256, `${what}.proposed_sha256`),
  };
}

export function parseTransitionChangeSet(text: string): TransitionChangeSet {
  assertNoSentinel(text, 'The transition change set');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    refuse(`The transition change set is not valid JSON: ${String(error)}`);
  }
  const o = asObject(doc, 'The transition change set');
  exactKeys(o, ['schema', 'season', 'inputs', 'replace', 'register_patches', 'write_set'],
    'The transition change set', ['base', 'final_sha256']);
  if (o.schema !== TRANSITION_SCHEMA) {
    refuse(`The transition change set schema is ${JSON.stringify(o.schema)}, not ${TRANSITION_SCHEMA}.`);
  }
  if (!Number.isInteger(o.season)) refuse('The transition change set season must be an integer.');

  if (!Array.isArray(o.inputs)) refuse('The transition change set inputs must be an array.');
  const inputs = o.inputs.map((entry, index) => {
    const e = asObject(entry, `inputs[${index}]`);
    exactKeys(e, ['role', 'path', 'sha256'], `inputs[${index}]`);
    if (!(INPUT_ROLES as readonly unknown[]).includes(e.role)) {
      refuse(`inputs[${index}].role ${JSON.stringify(e.role)} is not one of ${INPUT_ROLES.join(', ')}.`);
    }
    return { role: e.role as InputRole, path: repoPath(e.path, `inputs[${index}].path`),
      sha256: hex(e.sha256, `inputs[${index}].sha256`) };
  });
  const roles = inputs.map((i) => i.role);
  if (new Set(roles).size !== roles.length || INPUT_ROLES.some((r) => !roles.includes(r))) {
    refuse(`inputs must bind each of ${INPUT_ROLES.join(', ')} exactly once.`);
  }

  if (!Array.isArray(o.replace)) refuse('The transition change set replace must be an array.');
  const replace = o.replace.map((entry, index) => fileRef(entry, `replace[${index}]`));

  if (!Array.isArray(o.register_patches)) refuse('register_patches must be an array.');
  const registerPatches = o.register_patches.map((entry, index) => {
    const e = asObject(entry, `register_patches[${index}]`);
    exactKeys(e, ['pointer', 'old', 'new'], `register_patches[${index}]`);
    if (typeof e.pointer !== 'string') refuse(`register_patches[${index}].pointer must be a string.`);
    parseJsonPointer(e.pointer);
    return { pointer: e.pointer, old: e.old, new: e.new };
  });

  if (!Array.isArray(o.write_set) || o.write_set.length === 0) {
    refuse('write_set must list every file the apply writes.');
  }
  const writeSet = o.write_set.map((p, index) => repoPath(p, `write_set[${index}]`));
  if (new Set(writeSet).size !== writeSet.length) refuse('write_set lists a path twice.');

  let finalSha256: Record<string, string> | null = null;
  if (o.final_sha256 !== undefined && o.final_sha256 !== null) {
    const f = asObject(o.final_sha256, 'final_sha256');
    finalSha256 = {};
    for (const [path, value] of Object.entries(f)) {
      finalSha256[repoPath(path, 'final_sha256 key')] = hex(value, `final_sha256[${path}]`);
    }
  }

  return {
    season: o.season as number,
    inputs,
    base: o.base === undefined || o.base === null ? null : fileRef(o.base, 'base'),
    replace,
    registerPatches,
    writeSet,
    finalSha256,
  };
}

/** Key-order-insensitive form, so a reordered object is not mistaken for an edit. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : typeof v === 'object' && v !== null
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Json)[k])])) : v;
  return JSON.stringify(sort(value));
}

function getPointer(doc: unknown, pointer: string): unknown {
  let cursor: unknown = doc;
  for (const segment of parseJsonPointer(pointer)) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)
        || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = (cursor as Json)[segment];
  }
  return cursor;
}

function decodeExact(bytes: Buffer, what: string): string {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) refuse(`${what} is not valid UTF-8, so its hash cannot be re-derived from its text.`);
  return text;
}

export type PreparedTransition = {
  changeSet: TransitionChangeSet;
  /** Handed to the planner. */
  transition: TransitionInput;
  /** Whole-file replacements, written verbatim after the AFL Tables switch. */
  replacements: PlannedFile[];
  notes: string[];
};

/**
 * Judge the change set against the bytes actually on disk, before any gate is spawned.
 * Refuses a stale old hash, a proposed file that is not the reviewed one, a sentinel, an input
 * that is not the one the CLI was given, a membership that is not exactly what would be
 * written, a base that edits planner-owned fields, and a replacement of a planner-owned file.
 */
export function prepareTransition(input: {
  changeSet: TransitionChangeSet;
  season: number;
  /** The parsed CURRENT contract (the planner's starting point). */
  currentContract: Json;
  /** Current bytes of a repository-relative path, or null when absent. */
  readRepo: (path: string) => Buffer | null;
  /** Reviewed proposed bytes of a repository-relative path, or null when absent. */
  readProposed: (path: string) => Buffer | null;
  /** The input files the CLI was actually given, by role. */
  inputs: Record<InputRole, { path: string; sha256: string }>;
}): PreparedTransition {
  const { changeSet, season, currentContract, readRepo, readProposed } = input;
  const notes: string[] = [];

  if (changeSet.season !== season) {
    refuse(`The change set is for season ${changeSet.season}, but --season is ${season}.`);
  }

  for (const bound of changeSet.inputs) {
    const given = input.inputs[bound.role];
    if (given.path !== bound.path || given.sha256 !== bound.sha256) {
      refuse(`Input ${bound.role} is stale or substituted: the change set binds `
        + `${bound.path} (${bound.sha256}) but the command line supplies ${given.path} `
        + `(${given.sha256}). Re-review the change set against the inputs actually used.`);
    }
  }

  const checkRef = (ref: TransitionFileRef, label: string): { text: string; proposed: string; doc: Json } => {
    const old = readRepo(ref.path);
    if (old === null) refuse(`${label}: ${ref.path} does not exist in the working tree.`);
    if (sha256Hex(old) !== ref.oldSha256) {
      refuse(`${label}: ${ref.path} is stale — the change set was written against bytes with SHA-256 `
        + `${ref.oldSha256}, but the working tree holds ${sha256Hex(old)}. Nothing is planned.`);
    }
    const bytes = readProposed(ref.proposedPath);
    if (bytes === null) refuse(`${label}: the proposed file ${ref.proposedPath} does not exist.`);
    if (sha256Hex(bytes) !== ref.proposedSha256) {
      refuse(`${label}: ${ref.proposedPath} is not the reviewed document (SHA-256 ${sha256Hex(bytes)}, `
        + `the change set names ${ref.proposedSha256}).`);
    }
    if (ref.proposedSha256 === ref.oldSha256) {
      refuse(`${label}: the proposed bytes equal the current bytes of ${ref.path}; a change set names only real changes.`);
    }
    const proposed = decodeExact(bytes, `${label} proposed file`);
    assertNoSentinel(proposed, `${label} proposed file ${ref.proposedPath}`);
    let doc: unknown;
    try {
      doc = JSON.parse(proposed);
    } catch (error) {
      refuse(`${label}: ${ref.proposedPath} is not valid JSON: ${String(error)}`);
    }
    return { text: decodeExact(old, `${label} current file`), proposed, doc: asObject(doc, `${label} proposed document`) };
  };

  let contractBase: Json | undefined;
  if (changeSet.base !== null) {
    if (changeSet.base.path !== TRANSITION_BASE_PATH) {
      refuse(`base may only be ${TRANSITION_BASE_PATH}, not ${changeSet.base.path}. Every other file is `
        + 'either planner-owned or a whole-file replacement.');
    }
    const { doc } = checkRef(changeSet.base, 'base');
    for (const pointer of PLANNER_BOUND_POINTERS) {
      const was = getPointer(currentContract, pointer);
      const now = getPointer(doc, pointer);
      if (canonical(was) !== canonical(now)) {
        refuse(`base edits ${pointer}, which the rollover planner reads or writes itself. That `
          + 'field changes only through the planner (the edit would be silently dropped or would '
          + 'change what the planner started from). Remove it from the base.');
      }
    }
    contractBase = doc;
    notes.push(`transition base: ${TRANSITION_BASE_PATH} derived from reviewed bytes `
      + `${changeSet.base.proposedSha256} (current ${changeSet.base.oldSha256}); the planner then applies its own `
      + 'edits on top.');
  }

  const replacements: PlannedFile[] = [];
  const seen = new Set<string>();
  for (const ref of changeSet.replace) {
    if (PLANNER_OWNED_WRITES.includes(ref.path)) {
      refuse(`replace names ${ref.path}, which the rollover planner writes itself. It is derived, `
        + 'never supplied.');
    }
    if (!TRANSITION_REPLACEABLE_PATHS.includes(ref.path)) {
      refuse(`replace names ${ref.path}, which is not one of the replaceable contracts `
        + `(${TRANSITION_REPLACEABLE_PATHS.join(', ')}).`);
    }
    if (seen.has(ref.path)) refuse(`replace names ${ref.path} twice.`);
    seen.add(ref.path);
    const { proposed } = checkRef(ref, `replace ${ref.path}`);
    replacements.push({ path: ref.path, content: proposed, reformatted: false });
    notes.push(`transition replace: ${ref.path} ${ref.oldSha256} -> ${ref.proposedSha256} (verbatim).`);
  }

  const expected = new Set<string>([...PLANNER_OWNED_WRITES, ...replacements.map((r) => r.path)]);
  const declared = new Set(changeSet.writeSet);
  const missing = [...expected].filter((p) => !declared.has(p)).sort();
  const extra = [...declared].filter((p) => !expected.has(p)).sort();
  if (missing.length > 0 || extra.length > 0) {
    refuse('write_set is not the complete membership of this transition. '
      + `Missing: ${missing.join(', ') || 'none'}. Not written by this transition: ${extra.join(', ') || 'none'}. `
      + 'A partial change set is refused; name every file the apply writes.');
  }

  return {
    changeSet,
    transition: { contractBase, registerPatches: changeSet.registerPatches },
    replacements,
    notes,
  };
}

/**
 * Judge the planner's complete output against the change set and return the ordered write set.
 *
 * Order: the AFL Tables switch first (an interrupted write leaves AFL Tables retired, never
 * fetching the next season), then whole-file replacements, then the planner's own files. For
 * `apply`, `final_sha256` must pin the hash of EVERY file that would be written, so an apply only
 * ever writes bytes a dry run already showed.
 */
export function assertTransitionWriteSet(input: {
  prepared: PreparedTransition;
  /** The planner's files plus the AFL Tables switch. */
  planned: readonly PlannedFile[];
  apply: boolean;
}): { files: PlannedFile[]; finalHashes: Record<string, string> } {
  const { prepared, planned, apply } = input;

  const plannedPaths = planned.map((f) => f.path).sort();
  const ownedPaths = [...PLANNER_OWNED_WRITES].sort();
  if (JSON.stringify(plannedPaths) !== JSON.stringify(ownedPaths)) {
    refuse(`The planner produced [${plannedPaths.join(', ')}], not the expected [${ownedPaths.join(', ')}]. `
      + 'The change set was written against a different planner.');
  }
  const ordered: PlannedFile[] = [];
  const networkFirst = planned.find((f) => f.path === AFLTABLES_NETWORK_PATH);
  if (networkFirst) ordered.push(networkFirst);
  ordered.push(...prepared.replacements);
  ordered.push(...planned.filter((f) => f.path !== AFLTABLES_NETWORK_PATH));

  for (const file of ordered) {
    assertNoSentinel(file.content, `The planned ${file.path}`);
  }

  const finalHashes: Record<string, string> = {};
  for (const file of ordered) finalHashes[file.path] = sha256Hex(file.content);

  const pins = prepared.changeSet.finalSha256;
  if (apply && pins === null) {
    refuse('--apply needs final_sha256 in the change set: dry-run first, review the diff, then pin '
      + 'the printed SHA-256 of every file so the apply can only write bytes you reviewed.');
  }
  if (pins !== null) {
    const unpinned = Object.keys(finalHashes).filter((p) => !(p in pins));
    const unknown = Object.keys(pins).filter((p) => !(p in finalHashes));
    const differing = Object.keys(finalHashes).filter((p) => p in pins && pins[p] !== finalHashes[p]);
    if (unpinned.length > 0 || unknown.length > 0 || differing.length > 0) {
      refuse('final_sha256 does not describe this plan. '
        + `Unpinned: ${unpinned.join(', ') || 'none'}. Pinned but not written: ${unknown.join(', ') || 'none'}. `
        + `Different bytes: ${differing.map((p) => `${p} (plan ${finalHashes[p]}, pinned ${pins[p]})`).join('; ') || 'none'}.`);
    }
  }
  return { files: ordered, finalHashes };
}

// ---------------------------------------------------------------------------
// The concrete diff
// ---------------------------------------------------------------------------

export type Change = { where: string; kind: 'add' | 'remove' | 'change'; before?: string; after?: string };
export type FileDiff = {
  path: string; oldSha256: string; newSha256: string; oldBytes: number; newBytes: number;
  changes: Change[];
};

const brief = (value: unknown): string => {
  const s = JSON.stringify(value);
  return s.length > 110 ? `${s.slice(0, 107)}...` : s;
};

function jsonChanges(a: unknown, b: unknown, pointer: string, out: Change[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const where = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (!(key in a)) out.push({ where, kind: 'add', after: brief(b[key]) });
      else if (!(key in b)) out.push({ where, kind: 'remove', before: brief(a[key]) });
      else jsonChanges(a[key], b[key], where, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const where = `${pointer}/${i}`;
      if (i >= a.length) out.push({ where, kind: 'add', after: brief(b[i]) });
      else if (i >= b.length) out.push({ where, kind: 'remove', before: brief(a[i]) });
      else jsonChanges(a[i], b[i], where, out);
    }
    return;
  }
  out.push({ where: pointer || '/', kind: 'change', before: brief(a), after: brief(b) });
}

function lineChanges(a: string, b: string): Change[] {
  const x = a.split('\n'); const y = b.split('\n');
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head += 1;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head
    && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail += 1;
  const out: Change[] = [];
  for (let i = head; i < x.length - tail; i += 1) out.push({ where: `line ${i + 1}`, kind: 'remove', before: brief(x[i]) });
  for (let i = head; i < y.length - tail; i += 1) out.push({ where: `line ${i + 1}`, kind: 'add', after: brief(y[i]) });
  return out;
}

export function describeTransitionDiff(
  files: readonly PlannedFile[], readRepo: (path: string) => Buffer | null,
): FileDiff[] {
  return files.map((file) => {
    const old = readRepo(file.path);
    if (old === null) refuse(`${file.path} does not exist in the working tree, so it cannot be replaced.`);
    const oldText = old.toString('utf8');
    const changes: Change[] = [];
    if (file.path.endsWith('.json')) {
      jsonChanges(JSON.parse(oldText), JSON.parse(file.content), '', changes);
    } else {
      changes.push(...lineChanges(oldText, file.content));
    }
    return {
      path: file.path,
      oldSha256: sha256Hex(old),
      newSha256: sha256Hex(file.content),
      oldBytes: old.length,
      newBytes: Buffer.byteLength(file.content, 'utf8'),
      changes,
    };
  });
}

export function formatTransitionDiff(diffs: readonly FileDiff[], perFileCap = 120): string[] {
  const lines: string[] = [];
  for (const d of diffs) {
    lines.push(`  ${d.path}`);
    lines.push(`    ${d.oldSha256} (${d.oldBytes} B) -> ${d.newSha256} (${d.newBytes} B); ${d.changes.length} change(s)`);
    for (const c of d.changes.slice(0, perFileCap)) {
      const detail = c.kind === 'add' ? `+ ${c.after}` : c.kind === 'remove' ? `- ${c.before}` : `${c.before} => ${c.after}`;
      lines.push(`      ${c.where}  ${detail}`);
    }
    if (d.changes.length > perFileCap) lines.push(`      ... ${d.changes.length - perFileCap} more (git diff after apply shows all)`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The apply journal — detection and recovery, stated honestly
// ---------------------------------------------------------------------------

export type JournalEntry = { path: string; oldSha256: string; newSha256: string; oldBase64: string };
export type TransactionJournal = {
  schema: typeof TRANSACTION_JOURNAL_SCHEMA; season: number; entries: JournalEntry[];
};

export function buildTransactionJournal(
  season: number, files: readonly PlannedFile[], readRepo: (path: string) => Buffer | null,
): TransactionJournal {
  return {
    schema: TRANSACTION_JOURNAL_SCHEMA,
    season,
    entries: files.map((file) => {
      const old = readRepo(file.path);
      if (old === null) refuse(`${file.path} does not exist, so a recovery journal cannot record its old bytes.`);
      return { path: file.path, oldSha256: sha256Hex(old), newSha256: sha256Hex(file.content), oldBase64: old.toString('base64') };
    }),
  };
}

export type TransactionState = 'old' | 'new' | 'neither' | 'absent';

export function classifyTransaction(
  journal: TransactionJournal, diskSha256: (path: string) => string | null,
): Array<{ path: string; state: TransactionState }> {
  return journal.entries.map((e) => {
    const now = diskSha256(e.path);
    const state: TransactionState = now === null ? 'absent'
      : now === e.oldSha256 ? 'old' : now === e.newSha256 ? 'new' : 'neither';
    return { path: e.path, state };
  });
}

export function parseTransactionJournal(text: string): TransactionJournal {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse(`${TRANSACTION_JOURNAL_PATH} exists but is not valid JSON. An earlier apply was interrupted; `
      + 'restore the rollover files from Git, then delete it and any *.rollover-tmp files.');
  }
  const o = asObject(doc, TRANSACTION_JOURNAL_PATH);
  if (o.schema !== TRANSACTION_JOURNAL_SCHEMA || !Array.isArray(o.entries) || !Number.isInteger(o.season)) {
    refuse(`${TRANSACTION_JOURNAL_PATH} is not a ${TRANSACTION_JOURNAL_SCHEMA} journal.`);
  }
  return o as unknown as TransactionJournal;
}

/** The filesystem as the apply sees it; repository-relative paths. Injected so faults are testable. */
export type FileIo = {
  read(path: string): Buffer | null;
  write(path: string, content: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
};

/**
 * What an earlier, unfinished apply left behind, as lines to print, or null when nothing is
 * pending. Every invocation, dry run included, looks first: the journal and any staged file are
 * the only evidence an interrupted rename sequence leaves.
 */
export function pendingTransactionProblem(io: FileIo): string[] | null {
  const journalBytes = io.read(TRANSACTION_JOURNAL_PATH);
  if (journalBytes !== null) {
    const journal = parseTransactionJournal(journalBytes.toString('utf8'));
    const states = classifyTransaction(journal, (path) => {
      const bytes = io.read(path);
      return bytes === null ? null : sha256Hex(bytes);
    });
    return recoveryRequirements(journal, states);
  }
  const leftovers = [...PLANNER_OWNED_WRITES, ...TRANSITION_REPLACEABLE_PATHS, TRANSACTION_JOURNAL_PATH]
    .map((path) => `${path}${STAGING_SUFFIX}`)
    .filter((path) => io.read(path) !== null);
  return leftovers.length === 0 ? null : [
    `Staged rollover files from an earlier run remain: ${leftovers.join(', ')}.`,
    'No rename sequence completed, so the tracked files are untouched: delete them and re-run from the dry run.',
  ];
}

/**
 * Stage every file, journal, rename, verify, then clear the journal.
 *
 * Nothing is renamed until every staged file has been read back; the journal is cleared only
 * after every target has been read back against the plan. A fault after the first rename leaves
 * the journal in place, which is what makes the next invocation refuse and print the steps.
 * There is no cross-file atomicity on a filesystem; this makes the incoherent window as short as
 * the rename sequence and makes it unmistakable if it is ever interrupted.
 */
export function applyStagedWrites(io: FileIo, season: number, files: readonly PlannedFile[]): void {
  const staged: string[] = [];
  const unstage = (): void => {
    for (const path of staged) io.remove(path);
    io.remove(`${TRANSACTION_JOURNAL_PATH}${STAGING_SUFFIX}`);
  };
  try {
    for (const file of files) {
      const path = `${file.path}${STAGING_SUFFIX}`;
      io.write(path, file.content);
      staged.push(path);
      const back = io.read(path);
      if (back === null || sha256Hex(back) !== sha256Hex(file.content)) {
        refuse(`Staging ${file.path} did not read back the planned bytes; nothing was renamed.`);
      }
    }
    const journal = buildTransactionJournal(season, files, (path) => io.read(path));
    io.write(`${TRANSACTION_JOURNAL_PATH}${STAGING_SUFFIX}`, `${JSON.stringify(journal, null, 2)}\n`);
    io.rename(`${TRANSACTION_JOURNAL_PATH}${STAGING_SUFFIX}`, TRANSACTION_JOURNAL_PATH);
  } catch (error) {
    unstage();
    throw error;
  }

  for (const file of files) io.rename(`${file.path}${STAGING_SUFFIX}`, file.path);

  const bad = files.filter((file) => {
    const bytes = io.read(file.path);
    return bytes === null || sha256Hex(bytes) !== sha256Hex(file.content);
  });
  if (bad.length > 0) {
    refuse(`Post-write verification failed for ${bad.map((f) => f.path).join(', ')}. `
      + `${TRANSACTION_JOURNAL_PATH} was kept; the next invocation prints the recovery steps.`);
  }
  io.remove(TRANSACTION_JOURNAL_PATH);
}

/** Why the CLI stops, and exactly what the operator must do. */
export function recoveryRequirements(
  journal: TransactionJournal, states: ReadonlyArray<{ path: string; state: TransactionState }>,
): string[] {
  const lines = [
    `An earlier rollover apply for season ${journal.season} did not finish (${TRANSACTION_JOURNAL_PATH} exists).`,
    'The rollover files are NOT a coherent pair until this is resolved; no gate, rebuild or dry run is safe.',
  ];
  for (const s of states) lines.push(`  ${s.state.padEnd(7)} ${s.path}`);
  const allNew = states.every((s) => s.state === 'new');
  const allOld = states.every((s) => s.state === 'old');
  if (allNew) {
    lines.push('Every file already holds the reviewed new bytes: verify with `git diff`, delete the journal and any *.rollover-tmp files, then continue.');
  } else if (allOld) {
    lines.push('Every file still holds the old bytes: delete the journal and any *.rollover-tmp files, then re-run.');
  } else {
    lines.push('Files are mixed. Restore EVERY listed file to its old bytes (git checkout -- <path>, or decode its oldBase64 from the journal if the old bytes were not committed), '
      + 'delete the journal and any *.rollover-tmp files, then re-run from the dry run. Do not commit this state.');
  }
  return lines;
}
