/**
 * AFLDB-ISSUE-252 — the promotion-source dependency manifest and ownership-parity gate.
 *
 * Pure: no connection, no file I/O. The target reader (PROD, read-only), the source judge
 * (DEV, `afldb_test`) and the preparation CLI call these functions; everything that decides
 * PASS or STOP lives here so it is provable without a database.
 *
 * D-252-6. The source (`afldb_test`, DEV) and the PROD target live on different hosts, so the
 * checker never opens a cross-host connection. The TARGET emits a deterministic dependency
 * manifest; the SOURCE judges it. `dependency_set_sha256` is computed over canonical
 * dependency content ONLY — `captured_at` and the database OID are metadata — so an unchanged
 * dependency set captured pre-freeze (A) and again from the frozen database (B) hashes
 * identically, and any dependency created in between changes the hash.
 *
 * D-252-8. Resolution is not enough: every dependency's match must resolve exactly once in the
 * prepared source by the SAME `match_key` string, AND carry the same owning source key as on
 * the target. Ownership is never re-derived, normalised or defaulted; a mismatch is a STOP.
 *
 * A target numeric id never reaches the source. The manifest carries target row identities for
 * audit only (`target_row`, a string), and the judge pairs identities through synthetic
 * ordinals, so no target integer is ever compared with, or looked up as, a source id.
 */
import { createHash } from 'node:crypto';

import {
  aflApiRefusalCensusSha256,
  compareAflApiRefusalCensusEntries,
  type AflApiRefusalCensusEntry,
} from '../../src/lib/acquisition/afl-api-refusal-evidence';
import { AFL_API_SEASON_EVIDENCE_MATCH_METHOD } from '../../src/lib/acquisition/afl-api-player-evidence';
import {
  PLAYER_MATCH_STATS_ENTITY,
  decodePlayerMatchStatsKey,
} from '../../src/lib/acquisition/match-sheet-authority';
import {
  decodeMatchCoachKey,
  environmentNames,
  historicalOnlyFor,
  lineageBoundTables,
  lineageTargetsOf,
  publicContractTables,
  quoteIdent,
  quoteSqlLiteral,
  resolveLineageRemap,
  rowIdColumnOf,
  type Environment,
  type IdentityPair,
  type LineageRemapReason,
  type TableTreatment,
} from './promotion-inventory';

export const DEPENDENCY_MANIFEST_KIND = 'afldb_promotion_target_dependency_manifest';
export const DEPENDENCY_MANIFEST_SCHEMA_VERSION = 1;
export const SOURCE_DEPENDENCY_PROOF_KIND = 'afldb_promotion_source_dependency_proof';
/**
 * 2: the bound preparation carries the AFL Tables initial apply and its closure dry run separately (Q-252-10).
 * 3: it also carries the AFL API refusal census and the player-bridge prerequisite (D-252-12/13).
 */
export const SOURCE_DEPENDENCY_PROOF_SCHEMA_VERSION = 3;
/** Written by `prepare-promotion-source.ts --apply`; bound into the source proof. */
export const PREPARATION_RECORD_KIND = 'afldb_promotion_source_preparation_record';
/**
 * 2: `afltables_initial_apply` and `afltables_closure_dry_run` are mandatory and never collapsed (Q-252-10).
 * 3: `afl_api_refusal_census` (D-252-12) and `afl_api_player_bridge` (D-252-13) are mandatory.
 */
export const PREPARATION_RECORD_SCHEMA_VERSION = 3;

/** The three dependency families ISSUE-252 owns (D-252-4). Reported separately, always. */
export type DependencyFamilyId = 'F1' | 'F2' | 'F3';

export type DependencyFamily = {
  id: DependencyFamilyId;
  /** The contract table whose rows are read on the target. */
  table: string;
  description: string;
};

export const DEPENDENCY_FAMILIES: readonly DependencyFamily[] = [
  { id: 'F1', table: 'brownlow_vote_entry_state', description: 'brownlow_vote_entry_state.match_id' },
  {
    id: 'F2', table: 'data_overrides',
    description: "active data_overrides whose entity_type is 'matches', 'match_coaches' or 'player_match_stats'",
  },
  { id: 'F3', table: 'data_edits', description: "data_edits.row_id where table_name = 'matches'" },
];

const FAMILY_IDS: readonly DependencyFamilyId[] = DEPENDENCY_FAMILIES.map((f) => f.id);

/**
 * The contract's own `entity: 'matches'` lineage references, mapped to F1/F3. F2 is the A4.3
 * replay set, which is not a lineage ref. Any OTHER contract reference into `matches` is an
 * unclassified dependency and refuses: a new contract table must join a family deliberately,
 * never be silently left out of the gate the way ISSUE-252 was.
 */
export function contractMatchDependencyRefs(
  tables: readonly TableTreatment[] = lineageBoundTables(),
): { family: 'F1' | 'F3'; table: string; column: string; kindColumn?: string; kind?: string }[] {
  const out: { family: 'F1' | 'F3'; table: string; column: string; kindColumn?: string; kind?: string }[] = [];
  const unclassified: string[] = [];
  for (const table of tables) {
    for (const { ref, target } of lineageTargetsOf(table)) {
      if (target.entity !== 'matches') continue;
      const label = `${table.name}.${ref.column}${target.kind ? `[${ref.kindColumn}=${target.kind}]` : ''}`;
      if (target.identity !== 'match_key') { unclassified.push(`${label} (identity ${target.identity})`); continue; }
      if (table.name === 'brownlow_vote_entry_state' && ref.column === 'match_id' && !target.kind) {
        out.push({ family: 'F1', table: table.name, column: ref.column });
      } else if (table.name === 'data_edits' && ref.column === 'row_id'
        && ref.kindColumn === 'table_name' && target.kind === 'matches') {
        out.push({ family: 'F3', table: table.name, column: ref.column, kindColumn: ref.kindColumn, kind: target.kind });
      } else {
        unclassified.push(label);
      }
    }
  }
  if (unclassified.length > 0) {
    throw new Error(
      `The promotion contract declares match references no ISSUE-252 dependency family covers: `
      + `${unclassified.join(', ')}. Add a family deliberately; the gate refuses to ignore one.`,
    );
  }
  for (const family of ['F1', 'F3'] as const) {
    if (!out.some((r) => r.family === family)) {
      throw new Error(`The promotion contract no longer declares dependency family ${family}; refusing.`);
    }
  }
  return out;
}

/**
 * Which families this environment judges. A family whose table the contract declares
 * historical-only here (`data_edits` on dev today) is `withheld_by_contract`; on prod all
 * three are judged.
 */
export function familyStatusesFor(
  environment: Environment,
  tables: readonly TableTreatment[] = publicContractTables(),
): Record<DependencyFamilyId, FamilyStatus> {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const out = {} as Record<DependencyFamilyId, FamilyStatus>;
  for (const family of DEPENDENCY_FAMILIES) {
    const table = byName.get(family.table);
    if (!table) throw new Error(`Dependency family ${family.id}'s table '${family.table}' is not a contract table.`);
    out[family.id] = historicalOnlyFor(table, environment) ? 'withheld_by_contract' : 'judged';
  }
  return out;
}

export type FamilyStatus = 'judged' | 'withheld_by_contract';

/** F2: the stable match identity an active override names, or null when it names none. */
export function overrideMatchKeyOf(entityType: string, entityKey: string): string | null {
  if (entityType === 'matches') return entityKey.length > 0 ? entityKey : null;
  if (entityType === 'match_coaches') return decodeMatchCoachKey(entityKey)?.matchKey || null;
  // AFLDB-ISSUE-257: `<match_key>|<identity>`, decoded at the LAST `|`; an undecodable key names none.
  if (entityType === PLAYER_MATCH_STATS_ENTITY) return decodePlayerMatchStatsKey(entityKey)?.matchKey || null;
  return null;
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/**
 * `owned`: the target match exists and its `source_id` resolves to a readable `sources.key`.
 * `unowned`: `source_id IS NULL` (provenance unknown — never "free to adopt").
 * `indeterminate`: no single target match (none, several, or an unreadable owner).
 */
export type OwnerState = 'owned' | 'unowned' | 'indeterminate';

export type TargetDependency = {
  family: DependencyFamilyId;
  /** Audit only, e.g. `brownlow_vote_entry_state:match_id=17795`. Never a lookup key. */
  target_row: string;
  /** Distinct stable identities derived on the target, sorted. 0 = none, >1 = ambiguous. */
  match_keys: string[];
  owner_state: OwnerState;
  /** The target match's owning `sources.key`; non-null exactly when `owner_state` is `owned`. */
  owner_source_key: string | null;
};

export type DependencyManifest = {
  kind: typeof DEPENDENCY_MANIFEST_KIND;
  schema_version: number;
  environment: Environment;
  target_database: string;
  /** Metadata: never part of `dependency_set_sha256`. */
  captured_at: string;
  /** Metadata: never part of `dependency_set_sha256`. */
  target_database_oid: number | null;
  /**
   * Metadata: the AFLDB-ISSUE-250 freeze token the capture was proved under (manifest B), or
   * null for a pre-freeze capture (manifest A). Never part of `dependency_set_sha256`, so A and
   * B of an unchanged set hash identically.
   */
  freeze_token: string | null;
  families: Record<DependencyFamilyId, { status: FamilyStatus; rows: number }>;
  dependencies: TargetDependency[];
  dependency_set_sha256: string;
};

/** One row as a target reader returns it: one per (target row, derived identity). */
export type TargetDependencyReading = {
  family: DependencyFamilyId;
  target_row: string;
  match_key: string | null;
  /** The target match's `source_id` is set (whether or not its key was readable). */
  owner_source_id_present: boolean;
  owner_source_key: string | null;
  /** False when the identity names no target match at all (an F2 key, a dangling row id). Default true. */
  target_match_present?: boolean;
};

/**
 * Group reader rows into dependencies. A target row with several identities stays ONE
 * dependency with several keys, so the judge sees the ambiguity instead of a lucky pick.
 */
export function buildTargetDependencies(readings: readonly TargetDependencyReading[]): TargetDependency[] {
  const grouped = new Map<string, TargetDependencyReading[]>();
  for (const r of readings) {
    if (!FAMILY_IDS.includes(r.family)) throw new Error(`Unknown dependency family '${r.family}'.`);
    if (!r.target_row) throw new Error('A dependency reading needs a target_row.');
    const k = `${r.family}\u0000${r.target_row}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(r);
  }
  const out: TargetDependency[] = [];
  for (const rows of grouped.values()) {
    const keys = [...new Set(rows.map((r) => r.match_key).filter((k): k is string => k !== null))].sort();
    let owner_state: OwnerState = 'indeterminate';
    let owner_source_key: string | null = null;
    if (keys.length === 1) {
      const owners = rows.filter((r) => r.match_key === keys[0]);
      const distinct = new Set(owners.map((r) => `${r.target_match_present !== false}|${r.owner_source_id_present}|${r.owner_source_key}`));
      if (distinct.size === 1 && owners[0].target_match_present !== false) {
        const o = owners[0];
        if (!o.owner_source_id_present) owner_state = 'unowned';
        else if (o.owner_source_key) { owner_state = 'owned'; owner_source_key = o.owner_source_key; }
      }
    }
    out.push({ family: rows[0].family, target_row: rows[0].target_row, match_keys: keys, owner_state, owner_source_key });
  }
  return sortDependencies(out);
}

function sortDependencies(deps: readonly TargetDependency[]): TargetDependency[] {
  return [...deps].sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1
    : a.target_row < b.target_row ? -1 : a.target_row > b.target_row ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The readers' SQL. Unqualified table names: the target read runs under the target's own
// search_path (the code_test_db rehearsal reads a schema that way). Read-only SELECTs only.
// ---------------------------------------------------------------------------

/**
 * Matches by stable identity only. The target uses it to read an F2 key's owner; the source
 * uses it for the judgement. The `id` never leaves the database it was read from.
 */
export const MATCHES_BY_KEY_SQL = `
  SELECT m.id::bigint AS id, m.match_key AS match_key,
         (m.source_id IS NOT NULL) AS owner_present, s.key AS owner_key
    FROM matches m
    LEFT JOIN sources s ON s.id = m.source_id
   WHERE m.match_key = ANY ($1::text[])
   ORDER BY m.match_key, m.id`;

/** F2 on the target: the A4.3 replay set, anchored by `data_overrides.id` (audit only). */
export const F2_OVERRIDES_SQL = `
  SELECT 'data_overrides:id=' || o.id::text AS target_row, o.entity_type AS entity_type, o.entity_key AS entity_key
    FROM data_overrides o
   WHERE o.is_active AND o.entity_type IN ('matches', 'match_coaches', 'player_match_stats')
   ORDER BY o.id`;

export const F2_COUNT_SQL = `
  SELECT count(*)::int AS n FROM data_overrides o
   WHERE o.is_active AND o.entity_type IN ('matches', 'match_coaches', 'player_match_stats')`;

export type TargetFamilyReader = { family: 'F1' | 'F3'; table: string; rowsSql: string; countSql: string };

/**
 * F1 and F3's target readers, generated from the contract's own match references (so a
 * reference the contract adds joins the gate through `contractMatchDependencyRefs`, which
 * refuses an unclassified one). Every row of the family is read, whether or not its match
 * still exists: a dangling row is a dependency with no identity, never a skipped row.
 */
export function contractFamilyReaders(tables: readonly TableTreatment[] = lineageBoundTables()): TargetFamilyReader[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  return contractMatchDependencyRefs(tables).map((ref) => {
    const table = byName.get(ref.table)!;
    const rowId = rowIdColumnOf(table);
    const where = ref.kindColumn && ref.kind
      ? `WHERE t.${quoteIdent(ref.kindColumn)} = ${quoteSqlLiteral(ref.kind)}` : '';
    const from = `FROM ${quoteIdent(ref.table)} t`;
    return {
      family: ref.family,
      table: ref.table,
      rowsSql: `
  SELECT ${quoteSqlLiteral(`${ref.table}:${rowId}=`)} || t.${quoteIdent(rowId)}::text AS target_row,
         m.match_key AS match_key, (m.id IS NOT NULL) AS match_present,
         (m.source_id IS NOT NULL) AS owner_present, s.key AS owner_key
    ${from}
    LEFT JOIN matches m ON m.id = t.${quoteIdent(ref.column)}
    LEFT JOIN sources s ON s.id = m.source_id
   ${where}
   ORDER BY t.${quoteIdent(rowId)}`,
      countSql: `SELECT count(*)::int AS n ${from} ${where}`,
    };
  });
}

/** An F1/F3 reader row as a reading. */
export function readingOfContractRow(
  family: 'F1' | 'F3',
  row: { target_row: string; match_key: string | null; match_present: boolean; owner_present: boolean; owner_key: string | null },
): TargetDependencyReading {
  return {
    family, target_row: row.target_row, match_key: row.match_present ? row.match_key : null,
    owner_source_id_present: row.owner_present, owner_source_key: row.owner_key,
    target_match_present: row.match_present,
  };
}

/**
 * F2 readings: the identity is the override's own key (never a target id); its owner is the
 * target match carrying that key, or `target_match_present: false` when the target holds none.
 */
export function f2ReadingsOf(
  overrides: readonly { target_row: string; entity_type: string; entity_key: string }[],
  targetMatches: readonly SourceMatchReading[],
): TargetDependencyReading[] {
  const byKey = new Map<string, SourceMatchReading[]>();
  for (const m of targetMatches) {
    if (!byKey.has(m.match_key)) byKey.set(m.match_key, []);
    byKey.get(m.match_key)!.push(m);
  }
  const out: TargetDependencyReading[] = [];
  for (const o of overrides) {
    const key = overrideMatchKeyOf(o.entity_type, o.entity_key);
    const matches = key === null ? [] : byKey.get(key) ?? [];
    if (key === null || matches.length === 0) {
      out.push({ family: 'F2', target_row: o.target_row, match_key: key, owner_source_id_present: false,
        owner_source_key: null, target_match_present: false });
      continue;
    }
    for (const m of matches) {
      out.push({ family: 'F2', target_row: o.target_row, match_key: key,
        owner_source_id_present: m.owner_source_id_present, owner_source_key: m.owner_source_key });
    }
  }
  return out;
}

/**
 * Capture-time revalidation: every family's dependency count must equal a plain `count(*)` of
 * the rows it was read from. A reader that silently dropped rows cannot publish a manifest.
 */
export function familyCountProblems(
  manifest: Pick<DependencyManifest, 'families'>, counted: Partial<Record<DependencyFamilyId, number>>,
): string[] {
  const problems: string[] = [];
  for (const id of FAMILY_IDS) {
    const f = manifest.families[id];
    if (f.status !== 'judged') continue;
    const n = counted[id];
    if (n === undefined) problems.push(`${id}: no independent row count was taken`);
    else if (n !== f.rows) problems.push(`${id}: ${f.rows} dependencies read but count(*) is ${n}`);
  }
  return problems;
}

/** The canonical, hashed content: fixed key order, sorted dependencies, no metadata. */
function canonicalDependencyContent(m: {
  environment: string; target_database: string;
  families: Record<DependencyFamilyId, { status: FamilyStatus; rows: number }>;
  dependencies: readonly TargetDependency[];
}): string {
  return JSON.stringify({
    kind: DEPENDENCY_MANIFEST_KIND,
    schema_version: DEPENDENCY_MANIFEST_SCHEMA_VERSION,
    environment: m.environment,
    target_database: m.target_database,
    families: FAMILY_IDS.map((id) => [id, m.families[id].status, m.families[id].rows]),
    dependencies: sortDependencies(m.dependencies).map((d) => [
      d.family, d.target_row, [...d.match_keys].sort(), d.owner_state, d.owner_source_key,
    ]),
  });
}

export function dependencySetSha256(m: Parameters<typeof canonicalDependencyContent>[0]): string {
  return createHash('sha256').update(canonicalDependencyContent(m)).digest('hex');
}

export function buildDependencyManifest(input: {
  environment: Environment;
  targetDatabase: string;
  capturedAt: string;
  targetDatabaseOid: number | null;
  freezeToken?: string | null;
  familyStatuses: Record<DependencyFamilyId, FamilyStatus>;
  readings: readonly TargetDependencyReading[];
}): DependencyManifest {
  const live = environmentNames(input.environment).live;
  if (input.targetDatabase !== live) {
    throw new Error(`The dependency manifest is read from '${live}' only; refusing '${input.targetDatabase}'.`);
  }
  const dependencies = buildTargetDependencies(input.readings);
  for (const d of dependencies) {
    if (input.familyStatuses[d.family] !== 'judged') {
      throw new Error(`Family ${d.family} is withheld by contract in ${input.environment}; its rows are not read.`);
    }
  }
  const families = {} as DependencyManifest['families'];
  for (const id of FAMILY_IDS) {
    families[id] = { status: input.familyStatuses[id], rows: dependencies.filter((d) => d.family === id).length };
  }
  const base = { environment: input.environment, target_database: input.targetDatabase, families, dependencies };
  return {
    kind: DEPENDENCY_MANIFEST_KIND,
    schema_version: DEPENDENCY_MANIFEST_SCHEMA_VERSION,
    environment: input.environment,
    target_database: input.targetDatabase,
    captured_at: input.capturedAt,
    target_database_oid: input.targetDatabaseOid,
    freeze_token: input.freezeToken ?? null,
    families,
    dependencies,
    dependency_set_sha256: dependencySetSha256(base),
  };
}

/** The file bytes. Deterministic for a given manifest; `captured_at` makes files differ. */
export function renderDependencyManifest(m: DependencyManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

export function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const HEX64 = /^[0-9a-f]{64}$/;

function freezeTokenOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw new Error('freeze_token is malformed.');
  return value;
}

/**
 * Parse and validate manifest bytes. Refuses on a transport-hash mismatch (the operator's
 * recorded file sha256), a recomputed `dependency_set_sha256` that disagrees with the one
 * recorded, an environment or target database other than the expected one, or any malformed
 * dependency. Never repairs.
 */
export function parseDependencyManifest(input: {
  bytes: string;
  expectedFileSha256: string;
  expectedEnvironment: Environment;
}): DependencyManifest {
  if (!HEX64.test(input.expectedFileSha256)) throw new Error('The expected manifest file sha256 must be 64 lowercase hex.');
  const actual = sha256Hex(input.bytes);
  if (actual !== input.expectedFileSha256) {
    throw new Error(`Dependency manifest file sha256 ${actual} is not the recorded ${input.expectedFileSha256}; refusing.`);
  }
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(input.bytes) as Record<string, unknown>; } catch {
    throw new Error('The dependency manifest is not valid JSON.');
  }
  if (raw.kind !== DEPENDENCY_MANIFEST_KIND) throw new Error(`Not a dependency manifest (kind '${String(raw.kind)}').`);
  if (raw.schema_version !== DEPENDENCY_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported dependency manifest schema_version ${String(raw.schema_version)}.`);
  }
  if (raw.environment !== input.expectedEnvironment) {
    throw new Error(`Manifest environment '${String(raw.environment)}' is not '${input.expectedEnvironment}'.`);
  }
  const live = environmentNames(input.expectedEnvironment).live;
  if (raw.target_database !== live) {
    throw new Error(`Manifest target_database '${String(raw.target_database)}' is not '${live}'.`);
  }
  if (!Array.isArray(raw.dependencies)) throw new Error('The manifest has no dependencies array.');
  const seen = new Set<string>();
  const dependencies: TargetDependency[] = raw.dependencies.map((d: unknown, i: number) => {
    const r = d as Record<string, unknown>;
    const where = `dependencies[${i}]`;
    if (!FAMILY_IDS.includes(r.family as DependencyFamilyId)) throw new Error(`${where}: unknown family.`);
    if (typeof r.target_row !== 'string' || !r.target_row) throw new Error(`${where}: target_row missing.`);
    if (!Array.isArray(r.match_keys) || r.match_keys.some((k) => typeof k !== 'string' || !k)) {
      throw new Error(`${where}: match_keys must be an array of non-empty strings.`);
    }
    if (!['owned', 'unowned', 'indeterminate'].includes(r.owner_state as string)) throw new Error(`${where}: owner_state invalid.`);
    const ownerOk = r.owner_state === 'owned'
      ? typeof r.owner_source_key === 'string' && r.owner_source_key.length > 0
      : r.owner_source_key === null;
    if (!ownerOk) throw new Error(`${where}: owner_source_key must be set exactly when owner_state is 'owned'.`);
    const key = `${r.family}\u0000${r.target_row}`;
    if (seen.has(key)) throw new Error(`${where}: duplicate ${String(r.family)} ${r.target_row}.`);
    seen.add(key);
    return {
      family: r.family as DependencyFamilyId,
      target_row: r.target_row,
      match_keys: r.match_keys as string[],
      owner_state: r.owner_state as OwnerState,
      owner_source_key: r.owner_source_key as string | null,
    };
  });
  const families = raw.families as DependencyManifest['families'] | undefined;
  if (!families || typeof families !== 'object') throw new Error('The manifest has no families.');
  for (const id of FAMILY_IDS) {
    const f = families[id];
    if (!f || !['judged', 'withheld_by_contract'].includes(f.status)) throw new Error(`Family ${id} status missing.`);
    const rows = dependencies.filter((d) => d.family === id).length;
    if (f.rows !== rows) throw new Error(`Family ${id} declares ${f.rows} rows but carries ${rows}.`);
    if (f.status === 'withheld_by_contract' && rows > 0) throw new Error(`Family ${id} is withheld yet carries rows.`);
  }
  if (typeof raw.dependency_set_sha256 !== 'string' || !HEX64.test(raw.dependency_set_sha256)) {
    throw new Error('dependency_set_sha256 missing or malformed.');
  }
  const recomputed = dependencySetSha256({
    environment: raw.environment as string, target_database: raw.target_database as string, families, dependencies,
  });
  if (recomputed !== raw.dependency_set_sha256) {
    throw new Error(`dependency_set_sha256 recomputes to ${recomputed}, not the recorded ${raw.dependency_set_sha256}; refusing.`);
  }
  return {
    kind: DEPENDENCY_MANIFEST_KIND,
    schema_version: DEPENDENCY_MANIFEST_SCHEMA_VERSION,
    environment: input.expectedEnvironment,
    target_database: live,
    captured_at: typeof raw.captured_at === 'string' ? raw.captured_at : '',
    target_database_oid: typeof raw.target_database_oid === 'number' ? raw.target_database_oid : null,
    freeze_token: freezeTokenOf(raw.freeze_token),
    families,
    dependencies: sortDependencies(dependencies),
    dependency_set_sha256: recomputed,
  };
}

export type ManifestComparison = {
  identical: boolean;
  added: string[];
  removed: string[];
  changed: string[];
};

/**
 * Pre-freeze manifest A against the authoritative frozen manifest B. Identical sets mean the
 * earlier source proof MAY stand (its other bindings are still checked by
 * `sourceProofBindingProblems`); anything else requires a fresh source gate against B.
 */
export function compareDependencyManifests(pre: DependencyManifest, frozen: DependencyManifest): ManifestComparison {
  if (pre.environment !== frozen.environment || pre.target_database !== frozen.target_database) {
    throw new Error('The two dependency manifests name different targets; they cannot be compared.');
  }
  const label = (d: TargetDependency) => `${d.family} ${d.target_row}`;
  const content = (d: TargetDependency) => JSON.stringify([d.match_keys, d.owner_state, d.owner_source_key]);
  const a = new Map(pre.dependencies.map((d) => [label(d), content(d)]));
  const b = new Map(frozen.dependencies.map((d) => [label(d), content(d)]));
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).sort();
  return {
    identical: pre.dependency_set_sha256 === frozen.dependency_set_sha256,
    added, removed, changed,
  };
}

// ---------------------------------------------------------------------------
// The source judgement (ownership parity)
// ---------------------------------------------------------------------------

/** One prepared-source match, read by `match_key` only (never by a target id). */
export type SourceMatchReading = {
  id: number;
  match_key: string;
  owner_source_id_present: boolean;
  owner_source_key: string | null;
};

export type DependencyRefusalReason =
  | LineageRemapReason
  | 'target_owner_not_owned'
  | 'source_owner_not_owned'
  | 'owner_mismatch';

export type FamilyJudgement = {
  family: DependencyFamilyId;
  status: FamilyStatus;
  rowsInspected: number;
  identitiesDerived: number;
  resolved: number;
  ownershipMatched: number;
  refusals: {
    target_row: string;
    reason: DependencyRefusalReason;
    match_key?: string;
    target_owner?: string | null;
    source_owner?: string | null;
  }[];
};

export type SourceDependencyJudgement = {
  pass: boolean;
  dependencySetSha256: string;
  families: FamilyJudgement[];
};

function sourceOwnerOf(rows: readonly SourceMatchReading[]): { state: OwnerState; key: string | null } {
  if (rows.length !== 1) return { state: 'indeterminate', key: null };
  const r = rows[0];
  if (!r.owner_source_id_present) return { state: 'unowned', key: null };
  return r.owner_source_key ? { state: 'owned', key: r.owner_source_key } : { state: 'indeterminate', key: null };
}

/**
 * Judge the manifest against the prepared source. Per family, through the UNCHANGED
 * `resolveLineageRemap()`: the target side is the manifest's identities keyed by synthetic
 * ordinals (a target integer never enters), the candidate side is the source's
 * `(id, match_key)` pairs. Exactly-once resolution is resolveLineageRemap's own rule; on top of
 * it the owner must be `owned` on both sides by the same `sources.key`. Families never offset
 * each other; any refusal anywhere fails the whole gate.
 */
export function judgeSourceDependencies(input: {
  manifest: DependencyManifest;
  sourceMatches: readonly SourceMatchReading[];
}): SourceDependencyJudgement {
  const candidateIdentities: IdentityPair[] = input.sourceMatches.map((m) => ({ id: m.id, identity: m.match_key }));
  const sourceByKey = new Map<string, SourceMatchReading[]>();
  for (const m of input.sourceMatches) {
    if (!sourceByKey.has(m.match_key)) sourceByKey.set(m.match_key, []);
    sourceByKey.get(m.match_key)!.push(m);
  }
  const families: FamilyJudgement[] = DEPENDENCY_FAMILIES.map(({ id }) => {
    const status = input.manifest.families[id].status;
    const deps = input.manifest.dependencies.filter((d) => d.family === id);
    const judgement: FamilyJudgement = {
      family: id, status, rowsInspected: deps.length,
      identitiesDerived: deps.filter((d) => d.match_keys.length === 1).length,
      resolved: 0, ownershipMatched: 0, refusals: [],
    };
    if (status !== 'judged') return judgement;
    const ordinalOf = new Map<number, TargetDependency>();
    const replacedIdentities: IdentityPair[] = [];
    deps.forEach((d, i) => {
      ordinalOf.set(i + 1, d);
      for (const key of d.match_keys) replacedIdentities.push({ id: i + 1, identity: key });
    });
    const remap = resolveLineageRemap({
      entity: 'matches', rule: 'match_key',
      referencedIds: deps.map((_, i) => i + 1), replacedIdentities, candidateIdentities,
    });
    for (const u of remap.unresolved) {
      judgement.refusals.push({ target_row: ordinalOf.get(u.oldId)!.target_row, reason: u.reason, match_key: u.identity });
    }
    for (const m of remap.mapped) {
      judgement.resolved += 1;
      const dep = ordinalOf.get(m.oldId)!;
      const source = sourceOwnerOf(sourceByKey.get(m.identity) ?? []);
      const base = { target_row: dep.target_row, match_key: m.identity, target_owner: dep.owner_source_key, source_owner: source.key };
      if (dep.owner_state !== 'owned') judgement.refusals.push({ ...base, reason: 'target_owner_not_owned' });
      else if (source.state !== 'owned') judgement.refusals.push({ ...base, reason: 'source_owner_not_owned' });
      else if (source.key !== dep.owner_source_key) judgement.refusals.push({ ...base, reason: 'owner_mismatch' });
      else judgement.ownershipMatched += 1;
    }
    judgement.refusals.sort((a, b) => (a.target_row < b.target_row ? -1 : a.target_row > b.target_row ? 1 : 0));
    return judgement;
  });
  return {
    pass: families.every((f) => f.refusals.length === 0),
    dependencySetSha256: input.manifest.dependency_set_sha256,
    families,
  };
}

// ---------------------------------------------------------------------------
// The proof carried back to the target
// ---------------------------------------------------------------------------

/**
 * The per-family outcome in the operator's vocabulary. `unresolved` = no identity on the target
 * or none in the source; `ambiguous` = several on either side; `owner_mismatch` = both owned by
 * different sources; `other_refusals` = an unowned or unreadable owner on either side.
 */
export type FamilyOutcomeCounts = {
  rows_inspected: number;
  stable_identities: number;
  resolved: number;
  unresolved: number;
  ambiguous: number;
  owner_mismatch: number;
  other_refusals: number;
  ownership_matched: number;
};

export function familyOutcomeCounts(f: FamilyJudgement): FamilyOutcomeCounts {
  const count = (...reasons: DependencyRefusalReason[]) => f.refusals.filter((r) => reasons.includes(r.reason)).length;
  return {
    rows_inspected: f.rowsInspected,
    stable_identities: f.identitiesDerived,
    resolved: f.resolved,
    unresolved: count('no_identity_in_replaced', 'identity_absent_in_candidate'),
    ambiguous: count('ambiguous_in_replaced', 'ambiguous_in_candidate'),
    owner_mismatch: count('owner_mismatch'),
    other_refusals: count('target_owner_not_owned', 'source_owner_not_owned'),
    ownership_matched: f.ownershipMatched,
  };
}

/**
 * The preparation record the source proof binds: which retained bytes built the prepared
 * source, and the batches that wrote it. Read from the record `prepare-promotion-source.ts
 * --apply` wrote, pinned by the operator-recorded sha256 of that file.
 */
export type PreparationBinding = {
  record_sha256: string;
  prepared_at: string;
  season: number;
  source_database: string;
  batches: { afltables: number | null; afl_api: number | null };
  afltables: { label: string; manifest_sha256: string; observations_sha256: string };
  afl_api: { label: string; manifest_sha256: string };
  /**
   * Q-252-10: the AFL Tables initial apply (whose `unresolvedIdentityMatch` may be non-zero,
   * provisionally) and the same-label closure dry run that accepted it (all zero, no write).
   * Two results, never one.
   */
  afltables_closure: {
    initial_apply: AflTablesStepCounts;
    closure_dry_run: AflTablesStepCounts;
  };
  /**
   * D-252-12: every AFL API canonical refusal of the apply, in full, re-judged by the narrow
   * class on every parse. The count is whatever the retained snapshot produced, never a constant.
   */
  afl_api_refusal_census: AflApiRefusalCensusBinding;
  /** D-252-13: the retained current-season player bridge preparation applied before any settle. */
  afl_api_player_bridge: PlayerBridgeBinding;
};

export type AflTablesStepCounts = { inserted: number; updated: number; unresolved_identity_match: number };

export type AflApiRefusalCensusBinding = {
  accepted_class: typeof AFL_API_ACCEPTED_REFUSAL_CLASS;
  count: number;
  sha256: string;
  entries: AflApiRefusalCensusEntry[];
};

export type PlayerBridgeBinding = {
  file_sha256: string;
  match_method: typeof PLAYER_BRIDGE_MATCH_METHOD;
  snapshot_label: string;
  snapshot_manifest_sha256: string;
  required_providers: number;
  linked_providers: number;
  import_batch_id: number;
};

/** The preparation step order a record must show (Q-252-10: the closure dry run sits between the sources). */
export const PREPARATION_STEP_SEQUENCE = ['afltables:apply', 'afltables:dry-run', 'afl_api:dry-run', 'afl_api:apply'] as const;

function stepFromEvidence(raw: Record<string, unknown>): SettleStepSummary {
  return {
    source: raw.source as SettleStepSummary['source'],
    mode: raw.mode as SettleStepSummary['mode'],
    halt: typeof raw.halt === 'string' ? raw.halt : null,
    rollbackReason: typeof raw.rollback_reason === 'string' ? raw.rollback_reason : null,
    completeness: typeof raw.completeness === 'string' ? raw.completeness : null,
    applied: raw.applied === true,
    counters: raw.counters && typeof raw.counters === 'object' ? raw.counters as Record<string, unknown> : null,
  };
}

function stepCounts(step: SettleStepSummary): AflTablesStepCounts {
  const n = (key: string) => Number(step.counters?.[key]);
  return { inserted: n('canonicalRowsInserted'), updated: n('canonicalRowsUpdated'), unresolved_identity_match: n(AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER) };
}

/**
 * Parse the preparation record. Refuses a transport sha mismatch, another kind or schema, a
 * record for any database but the prepared source, the wrong order, a missing input hash, a
 * record that does not show both settles committed with a complete source, and (Q-252-10) a
 * record whose AFL Tables initial apply or closure dry run is missing or fails its contract.
 */
export function parsePreparationRecord(input: {
  bytes: string;
  expectedFileSha256: string;
  expectedSourceDatabase: string;
}): PreparationBinding {
  if (!HEX64.test(input.expectedFileSha256)) throw new Error('The expected preparation record sha256 must be 64 lowercase hex.');
  const actual = sha256Hex(input.bytes);
  if (actual !== input.expectedFileSha256) {
    throw new Error(`Preparation record sha256 ${actual} is not the recorded ${input.expectedFileSha256}; refusing.`);
  }
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(input.bytes) as Record<string, unknown>; } catch {
    throw new Error('The preparation record is not valid JSON.');
  }
  if (raw.kind !== PREPARATION_RECORD_KIND) throw new Error(`Not a preparation record (kind '${String(raw.kind)}').`);
  if (raw.schema_version !== PREPARATION_RECORD_SCHEMA_VERSION) {
    throw new Error(`Unsupported preparation record schema_version ${String(raw.schema_version)}.`);
  }
  if (raw.source_database !== input.expectedSourceDatabase) {
    throw new Error(`The preparation record is for '${String(raw.source_database)}', not '${input.expectedSourceDatabase}'.`);
  }
  if (JSON.stringify(raw.order) !== JSON.stringify(PREPARATION_SOURCE_ORDER)) {
    throw new Error(`The preparation record's order is ${JSON.stringify(raw.order)}, not ${JSON.stringify(PREPARATION_SOURCE_ORDER)}.`);
  }
  if (typeof raw.season !== 'number' || typeof raw.prepared_at !== 'string' || !raw.prepared_at) {
    throw new Error('The preparation record has no season or prepared_at.');
  }
  const inputs = Array.isArray(raw.inputs) ? raw.inputs as Record<string, unknown>[] : [];
  const at = inputs.find((i) => i.source === 'afltables');
  const api = inputs.find((i) => i.source === 'afl_api');
  const label = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (inputs.length !== 2 || !at || !api || !label(at.label) || !label(api.label)
    || !HEX64.test(String(at.manifest_sha256)) || !HEX64.test(String(at.observations_sha256))
    || !HEX64.test(String(api.manifest_sha256))) {
    throw new Error('The preparation record does not name both retained inputs with their sha256s.');
  }
  const steps = Array.isArray(raw.steps) ? raw.steps as Record<string, unknown>[] : [];
  for (const source of PREPARATION_SOURCE_ORDER) {
    const applied = steps.find((s) => s.source === source && s.mode === 'apply');
    if (!applied || applied.applied !== true || applied.completeness !== 'complete') {
      throw new Error(`The preparation record does not show a committed, complete ${source} apply.`);
    }
  }
  const sequence = steps.map((s) => `${String(s.source)}:${String(s.mode)}`);
  if (JSON.stringify(sequence) !== JSON.stringify(PREPARATION_STEP_SEQUENCE)) {
    throw new Error(`The preparation record's steps are ${JSON.stringify(sequence)}, not ${JSON.stringify(PREPARATION_STEP_SEQUENCE)}.`);
  }
  const batches = (raw.batches ?? {}) as Record<string, unknown>;
  // The settles report `import_batches.id` (bigint) as decimal text; accept that or an integer.
  const batch = (v: unknown) => {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
    if (typeof v === 'string' && /^[1-9][0-9]{0,15}$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
    return null;
  };
  // Q-252-10: both AFL Tables results, each re-judged by the same guard the CLI ran.
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(raw.afltables_initial_apply) || !isObject(raw.afltables_closure_dry_run)) {
    throw new Error('The preparation record does not carry both AFL Tables results (initial apply and closure dry run, Q-252-10).');
  }
  const initial = stepFromEvidence(raw.afltables_initial_apply);
  const closure = stepFromEvidence(raw.afltables_closure_dry_run);
  const contract = [...afltablesFirstApplyProblems(initial), ...afltablesClosureDryRunProblems(closure)];
  if (contract.length > 0) {
    throw new Error(`The preparation record's AFL Tables results fail the Q-252-10 contract:\n${contract.map((p) => `  - ${p}`).join('\n')}`);
  }
  if (batch(raw.afltables_initial_apply.batch_id) === null || batch(raw.afltables_initial_apply.batch_id) !== batch(batches.afltables)) {
    throw new Error('The AFL Tables initial apply batch is not the record\'s AFL Tables batch.');
  }
  if (raw.afltables_closure_dry_run.batch_id !== null) {
    throw new Error('The AFL Tables closure dry run names a batch; a rolled-back dry run has none.');
  }
  // D-252-12: the AFL API refusal census, re-judged from its entries; the apply's own counter must
  // equal it, and the dry run the apply was checked against must have had the same digest.
  const census = aflApiRefusalCensusBindingOf(raw.afl_api_refusal_census, 'The preparation record');
  const censusRaw = raw.afl_api_refusal_census as Record<string, unknown>;
  const apiCounters = isObject(raw.counters) && isObject(raw.counters.afl_api) ? raw.counters.afl_api : null;
  if (apiCounters?.canonicalApplyRefusals !== census.count) {
    throw new Error(`The preparation record's AFL API apply canonicalApplyRefusals (${String(apiCounters?.canonicalApplyRefusals)}) `
      + `is not its refusal census count ${census.count}.`);
  }
  for (const phase of ['dry_run', 'apply'] as const) {
    const p = censusRaw[phase];
    if (!isObject(p) || p.sha256 !== census.sha256 || p.count !== census.count) {
      throw new Error(`The preparation record's AFL API ${phase.replace('_', ' ')} refusal census is not the bound census (dry-run/apply parity).`);
    }
  }
  // D-252-13: the player bridge prerequisite, bound to this record's own AFL API input.
  const bridge = playerBridgeBindingOf(raw.afl_api_player_bridge, {
    aflApiLabel: String(api.label), aflApiManifestSha256: String(api.manifest_sha256), season: raw.season,
  });
  return {
    record_sha256: actual,
    prepared_at: raw.prepared_at,
    season: raw.season,
    source_database: input.expectedSourceDatabase,
    batches: { afltables: batch(batches.afltables), afl_api: batch(batches.afl_api) },
    afltables: { label: String(at.label), manifest_sha256: String(at.manifest_sha256), observations_sha256: String(at.observations_sha256) },
    afl_api: { label: String(api.label), manifest_sha256: String(api.manifest_sha256) },
    afltables_closure: { initial_apply: stepCounts(initial), closure_dry_run: stepCounts(closure) },
    afl_api_refusal_census: census,
    afl_api_player_bridge: bridge,
  };
}

export type SourceDependencyProof = {
  kind: typeof SOURCE_DEPENDENCY_PROOF_KIND;
  schema_version: number;
  verdict: 'PASS';
  environment: Environment;
  target_database: string;
  /** The judged manifest: its semantic hash, its file bytes' hash, and when it was captured. */
  dependency_set_sha256: string;
  manifest_file_sha256: string;
  manifest_captured_at: string;
  source_database: string;
  /** Metadata: the prepared source's OID when judged. */
  source_database_oid: number | null;
  judged_at: string;
  preparation: PreparationBinding;
  families: ({ family: DependencyFamilyId; status: FamilyStatus } & FamilyOutcomeCounts)[];
};

/** Written only on PASS: a failing judgement has no proof to carry. */
export function buildSourceDependencyProof(input: {
  manifest: DependencyManifest;
  manifestFileSha256: string;
  sourceDatabase: string;
  sourceDatabaseOid: number | null;
  judgedAt: string;
  judgement: SourceDependencyJudgement;
  preparation: PreparationBinding;
}): SourceDependencyProof {
  if (!input.judgement.pass) throw new Error('The source dependency gate did not PASS; no proof is written.');
  if (input.judgement.dependencySetSha256 !== input.manifest.dependency_set_sha256) {
    throw new Error('The judgement was made against a different dependency set; refusing.');
  }
  const source = environmentNames(input.manifest.environment).source;
  if (input.sourceDatabase !== source) {
    throw new Error(`The prepared source must be '${source}', not '${input.sourceDatabase}'.`);
  }
  if (input.preparation.source_database !== source) {
    throw new Error(`The preparation record is for '${input.preparation.source_database}', not '${source}'.`);
  }
  if (!HEX64.test(input.manifestFileSha256)) throw new Error('The manifest file sha256 must be 64 lowercase hex.');
  return {
    kind: SOURCE_DEPENDENCY_PROOF_KIND,
    schema_version: SOURCE_DEPENDENCY_PROOF_SCHEMA_VERSION,
    verdict: 'PASS',
    environment: input.manifest.environment,
    target_database: input.manifest.target_database,
    dependency_set_sha256: input.manifest.dependency_set_sha256,
    manifest_file_sha256: input.manifestFileSha256,
    manifest_captured_at: input.manifest.captured_at,
    source_database: input.sourceDatabase,
    source_database_oid: input.sourceDatabaseOid,
    judged_at: input.judgedAt,
    preparation: input.preparation,
    families: input.judgement.families.map((f) => ({ family: f.family, status: f.status, ...familyOutcomeCounts(f) })),
  };
}

export function renderSourceDependencyProof(proof: SourceDependencyProof): string {
  return `${JSON.stringify(proof, null, 2)}\n`;
}

/**
 * Parse proof bytes carried back to the target. Refuses a transport sha mismatch against the
 * operator-recorded sha256, another kind/schema/environment, a verdict other than PASS, and any
 * family that reports a refusal (a PASS proof carries none).
 */
export function parseSourceDependencyProof(input: {
  bytes: string;
  expectedFileSha256: string;
  expectedEnvironment: Environment;
}): SourceDependencyProof {
  if (!HEX64.test(input.expectedFileSha256)) throw new Error('The expected source proof sha256 must be 64 lowercase hex.');
  const actual = sha256Hex(input.bytes);
  if (actual !== input.expectedFileSha256) {
    throw new Error(`Source dependency proof sha256 ${actual} is not the recorded ${input.expectedFileSha256}; refusing.`);
  }
  let raw: SourceDependencyProof;
  try { raw = JSON.parse(input.bytes) as SourceDependencyProof; } catch {
    throw new Error('The source dependency proof is not valid JSON.');
  }
  if (raw.kind !== SOURCE_DEPENDENCY_PROOF_KIND || raw.schema_version !== SOURCE_DEPENDENCY_PROOF_SCHEMA_VERSION) {
    throw new Error('Not a source dependency proof of a supported schema.');
  }
  if (raw.verdict !== 'PASS') throw new Error(`The source dependency proof's verdict is '${String(raw.verdict)}'.`);
  if (raw.environment !== input.expectedEnvironment) {
    throw new Error(`The source dependency proof is for environment '${String(raw.environment)}', not '${input.expectedEnvironment}'.`);
  }
  if (!HEX64.test(String(raw.dependency_set_sha256)) || !HEX64.test(String(raw.manifest_file_sha256))) {
    throw new Error('The source dependency proof carries a malformed manifest hash.');
  }
  const p = raw.preparation as PreparationBinding | undefined;
  if (!p || !HEX64.test(String(p.record_sha256)) || !HEX64.test(String(p.afltables?.manifest_sha256))
    || !HEX64.test(String(p.afltables?.observations_sha256)) || !HEX64.test(String(p.afl_api?.manifest_sha256))) {
    throw new Error('The source dependency proof does not bind a preparation record and its retained inputs.');
  }
  const closure = p.afltables_closure?.closure_dry_run;
  const initial = p.afltables_closure?.initial_apply;
  if (!closure || !initial || closure.inserted !== 0 || closure.updated !== 0 || closure.unresolved_identity_match !== 0
    || !Number.isInteger(initial.unresolved_identity_match) || initial.unresolved_identity_match < 0) {
    throw new Error('The source dependency proof does not bind a clean AFL Tables closure dry run beside the initial apply (Q-252-10).');
  }
  // D-252-12/13 (schema 3): the census is re-judged, never trusted, and the bridge must be whole.
  aflApiRefusalCensusBindingOf(p.afl_api_refusal_census, 'The source dependency proof');
  const bridgeProblems = proofBridgeProblems(p.afl_api_player_bridge, p.afl_api);
  if (bridgeProblems.length > 0) {
    throw new Error(`The source dependency proof does not bind the AFL API player bridge prerequisite (D-252-13): ${bridgeProblems.join('; ')}.`);
  }
  const families = Array.isArray(raw.families) ? raw.families : [];
  for (const id of FAMILY_IDS) {
    const f = families.find((x) => x.family === id);
    if (!f) throw new Error(`The source dependency proof has no family ${id}.`);
    if (f.unresolved !== 0 || f.ambiguous !== 0 || f.owner_mismatch !== 0 || f.other_refusals !== 0) {
      throw new Error(`The source dependency proof's family ${id} reports refusals; a PASS proof carries none.`);
    }
  }
  return raw;
}

/**
 * May an earlier proof stand for the authoritative FROZEN manifest? Only when it proved this
 * exact dependency set for this exact target. An empty list means yes; anything else means
 * rerun the source gate against the frozen manifest while PROD stays frozen.
 */
export function sourceProofBindingProblems(proof: SourceDependencyProof, frozen: DependencyManifest): string[] {
  const problems: string[] = [];
  if (proof.kind !== SOURCE_DEPENDENCY_PROOF_KIND || proof.schema_version !== SOURCE_DEPENDENCY_PROOF_SCHEMA_VERSION) {
    problems.push('not a source dependency proof of a supported schema');
  }
  if (proof.verdict !== 'PASS') problems.push(`proof verdict is '${String(proof.verdict)}'`);
  if (proof.environment !== frozen.environment) problems.push('proof environment differs from the frozen manifest');
  if (proof.target_database !== frozen.target_database) problems.push('proof target database differs from the frozen manifest');
  if (proof.source_database !== environmentNames(frozen.environment).source) problems.push('proof source database is not the prepared source');
  if (proof.dependency_set_sha256 !== frozen.dependency_set_sha256) {
    problems.push(`frozen dependency set ${frozen.dependency_set_sha256} is not the proven ${proof.dependency_set_sha256}; rerun the source gate against the frozen manifest`);
  }
  for (const id of FAMILY_IDS) {
    const status = (proof.families ?? []).find((f) => f.family === id)?.status;
    if (status !== frozen.families[id].status) problems.push(`family ${id} was ${String(status)} in the proof but is ${frozen.families[id].status} now`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Preparation guards (D-252-7, D-252-8)
// ---------------------------------------------------------------------------

/**
 * D-252-8: ownership-preserving order. AFL Tables establishes the current-season matches
 * first (as on PROD); the AFL API settle then meets AFL Tables-owned rows and corroborates
 * (`history_only`) or refuses (`foreign_owned_collision`) — it never becomes first writer.
 */
export const PREPARATION_SOURCE_ORDER = ['afltables', 'afl_api'] as const;

/**
 * One verified retained input, whatever its source. The two sources keep their own, unchanged
 * manifest layouts, so each is verified by its own reader (`prepare-promotion-source.ts`); this
 * is the common shape those readers return.
 *
 *   afltables  manifest `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json` hash-binds
 *              the raw CSVs under `data/sources/afltables/fitzroy_core/<label>/`. The settle
 *              consumes `<label>/observations.json`, which that manifest does NOT list (it is
 *              emitted afterwards and only names the manifest's digest), so the bundle is bound
 *              by its own recorded sha256 as well.
 *   afl_api    `data/sources/afl_api/matches/<label>/manifest.json` hash-binds every payload
 *              the settle reads; its own sha256 pins the whole snapshot.
 */
type RetainedSnapshotBindingBase = {
  label: string;
  /** The sha256 of the snapshot manifest the operator recorded when it was retained. */
  expectedManifestSha256: string;
  /** Recomputed from the bytes on disk by the caller. */
  actualManifestSha256: string;
  season: number | null;
  /** Source-specific integrity failures found by the reader (missing file, re-hash mismatch, wrong kind). */
  integrityProblems?: readonly string[];
};

export type AflTablesSnapshotBinding = RetainedSnapshotBindingBase & {
  source: 'afltables';
  /** The sha256 of `observations.json` the operator recorded when it was retained. */
  expectedBundleSha256: string;
  actualBundleSha256: string;
};

export type AflApiSnapshotBinding = RetainedSnapshotBindingBase & { source: 'afl_api' };

export type RetainedSnapshotBinding = AflTablesSnapshotBinding | AflApiSnapshotBinding;

function hashBindingProblems(what: string, where: string, expected: string, actual: string): string[] {
  if (!HEX64.test(expected)) return [`${where}: expected ${what} sha256 is not 64 lowercase hex`];
  return actual === expected ? [] : [`${where}: ${what} sha256 ${actual || '(unreadable)'} is not the recorded ${expected}`];
}

/** Every retained snapshot bound, in order, for exactly the one in-progress season. */
export function retainedSnapshotProblems(
  bindings: readonly RetainedSnapshotBinding[], inProgressSeasons: readonly number[],
): string[] {
  const problems: string[] = [];
  if (inProgressSeasons.length !== 1) {
    problems.push(`exactly one in-progress season is required, data/reference/seasons.json lists ${inProgressSeasons.length}`);
  }
  const order = bindings.map((b) => b.source).join(',');
  if (order !== PREPARATION_SOURCE_ORDER.join(',')) {
    problems.push(`preparation order must be ${PREPARATION_SOURCE_ORDER.join(' then ')}, got '${order}'`);
  }
  for (const b of bindings) {
    const where = `${b.source} '${b.label}'`;
    if (!b.label) problems.push(`${b.source}: no snapshot label`);
    problems.push(...hashBindingProblems('manifest', where, b.expectedManifestSha256, b.actualManifestSha256));
    if (b.source === 'afltables') {
      problems.push(...hashBindingProblems('observations.json', where, b.expectedBundleSha256, b.actualBundleSha256));
    }
    for (const p of b.integrityProblems ?? []) problems.push(`${where}: ${p}`);
    if (inProgressSeasons.length === 1 && b.season !== inProgressSeasons[0]) {
      problems.push(`${where}: season ${String(b.season)} is not the in-progress season ${inProgressSeasons[0]}`);
    }
  }
  return problems;
}

/**
 * D-252-8: before the AFL Tables settle runs, every in-progress-season match already in the
 * prepared source must be AFL Tables-owned (an idempotent rerun) or absent (a fresh rebuild).
 * An `afl_api`-owned or unowned one means the ownership-preserving order was already broken
 * on this database; preparation cannot reconstruct it and refuses — rebuild `afldb_test`.
 */
export function preexistingSeasonOwnershipProblems(
  season: number, rows: readonly { owner_source_key: string | null; matches: number }[],
): string[] {
  return rows
    .filter((r) => r.matches > 0 && r.owner_source_key !== PREPARATION_SOURCE_ORDER[0])
    .map((r) => `${r.matches} season-${season} match(es) are already ${r.owner_source_key ? `'${r.owner_source_key}'-owned` : 'unowned'} `
      + `in the prepared source; the AFL Tables-first order cannot be reconstructed — rebuild ${environmentNames('prod').source}`);
}

/**
 * §21.2 step 5: the counters that must be exactly zero after each settle. A counter the outcome
 * does not carry is itself a refusal: an unreadable run has not shown it was clean.
 */
export const PREPARATION_ZERO_COUNTERS = {
  afltables: [
    'snapshotRejections', 'snapshotUnkeyedRejections',
    'unresolvedIdentityPlayer', 'unresolvedIdentityClub', 'unresolvedIdentityVenue', 'unresolvedIdentityMatch',
    'foreignOwnedCollision', 'venueUnmapped', 'manualAuthorityRefusals',
    'canonicalApplyRefusals', 'canonicalApplyFailures',
  ],
  afl_api: [
    'buildFailures', 'unresolvedIdentityMatch', 'unresolvedIdentityPlayer', 'foreignOwnedCollision',
    'venueProviderUnmapped', 'venueUnmapped', 'manualAuthorityRefusals',
    'canonicalApplyRefusals', 'canonicalApplyFailures',
  ],
} as const satisfies Record<(typeof PREPARATION_SOURCE_ORDER)[number], readonly string[]>;

export type SettleStepSummary = {
  source: (typeof PREPARATION_SOURCE_ORDER)[number];
  /** What the step asked for: a rolled-back dry run or a committed apply. */
  mode: 'dry-run' | 'apply';
  halt: string | null;
  rollbackReason: string | null;
  /** `SourceCompletenessVerdict.status`, or null when the run produced none. */
  completeness: string | null;
  applied: boolean;
  counters: Readonly<Record<string, unknown>> | null;
  /**
   * D-252-12, AFL API steps only: the run's canonical refusal census (`canonicalAflApiRefusalCensus()`
   * of the settle's `refusalEvidence`). `null`/absent means none was reported, which is a STOP.
   */
  refusalCensus?: readonly AflApiRefusalCensusEntry[] | null;
};

/**
 * Q-252-10 (operator decision, option 1): the ONE counter the FIRST AFL Tables apply may carry
 * non-zero. For a match with no canonical row yet, the settle plans its period scores as a
 * pending unresolved target and counts `unresolvedIdentityMatch`, then applies them later in the
 * SAME run through the `pending_match` invitation (`settle-afltables.ts`). On a fresh
 * `afldb_test` it is therefore the number of NEW matches with period scores, not a failure. It
 * is tolerated only provisionally, recorded, and accepted only when the same-label closure dry
 * run proves it 0 with no write. Not a general exception: no other counter or source, and the
 * only other step that shares it is the standalone `--dry-run` preview (Q-252-11), which proves
 * nothing and is never recorded.
 */
export const AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER = 'unresolvedIdentityMatch';

/** Q-252-10: what the closure dry run must also show at 0 — no canonical mutation, no invited target. */
export const AFLTABLES_CLOSURE_NO_WRITE_COUNTERS = ['canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged'] as const;

/** §21.2 step 5, per settle. An `afl_api` `foreignOwnedCollision` is a real source disagreement: STOP, never re-own. */
export function settleStepProblems(step: SettleStepSummary): string[] {
  return stepPostConditionProblems(step, `${step.source} ${step.mode}`, null);
}

/**
 * Q-252-10, the first AFL Tables apply: every §21.2 post-condition, except that
 * `unresolvedIdentityMatch` may be a non-negative count. It is bounded by the canonical rows the
 * same apply inserted (pending period scores exist only for matches it inserted), so a non-zero
 * value beside 0 inserted rows is still a STOP. Any OTHER non-zero counter refuses immediately.
 */
export function afltablesFirstApplyProblems(step: SettleStepSummary): string[] {
  const where = 'afltables initial apply';
  if (step.source !== 'afltables' || step.mode !== 'apply') {
    return [`${step.source} ${step.mode}: the Q-252-10 first-apply contract covers the AFL Tables apply only`];
  }
  return transientUnresolvedMatchProblems(step, where);
}

/**
 * Q-252-11 (operator decision): what the standalone preparation `--dry-run` shows — an UNPROVEN
 * PREVIEW, never acceptance evidence. It plans exactly what the first apply would, so on a fresh
 * `afldb_test` it carries the same transient `unresolvedIdentityMatch`, judged exactly as the
 * first apply is (non-negative count, ≤ `canonicalRowsInserted`; every other §21.2 post-condition
 * strict, and the rolled-back dry run expected). The bound is a sanity check only: it does NOT
 * show that the pending targets are satisfied — only `--apply`'s closure dry run proves that. A
 * preview writes no preparation record and no proof, and never satisfies `--phase source`.
 */
export function afltablesPreviewDryRunProblems(step: SettleStepSummary): string[] {
  const where = 'afltables preview dry-run';
  if (step.source !== 'afltables' || step.mode !== 'dry-run') {
    return [`${step.source} ${step.mode}: the Q-252-11 preview contract covers the AFL Tables dry run only`];
  }
  return transientUnresolvedMatchProblems(step, where);
}

/** The status a successful preview reports: explicit that nothing was proven. */
export const PREPARATION_PREVIEW_STATUS = 'PREVIEW ONLY — UNPROVEN: transient same-run match dependencies are not yet proven resolved. '
  + 'No preparation record and no source proof were written; this is not promotion-source evidence. '
  + 'Only --apply, through its mandatory closure dry run, proves the source.';

/** Q-252-10/11: every post-condition, with `unresolvedIdentityMatch` alone allowed within the inserted-rows bound. */
function transientUnresolvedMatchProblems(step: SettleStepSummary, where: string): string[] {
  const problems = stepPostConditionProblems(step, where, AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER);
  if (!step.counters) return problems;
  const value = step.counters[AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER];
  const inserted = step.counters.canonicalRowsInserted;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problems.push(`${where}: counter ${AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER} is missing or not a count`);
  } else if (value > 0 && !(typeof inserted === 'number' && value <= inserted)) {
    problems.push(`${where}: ${AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER} = ${value} exceeds the ${String(inserted)} canonical rows `
      + `this ${step.mode} inserted; it cannot be the pending period scores of new matches`);
  }
  return problems;
}

/**
 * Q-252-10, the mandatory same-label AFL Tables closure dry run straight after the initial
 * apply: the authoritative proof. Every §21.2 post-condition with NO tolerance
 * (`unresolvedIdentityMatch` = 0), a rolled-back dry run, and no canonical mutation.
 */
export function afltablesClosureDryRunProblems(step: SettleStepSummary): string[] {
  const where = 'afltables closure dry-run';
  if (step.source !== 'afltables' || step.mode !== 'dry-run') {
    return [`${step.source} ${step.mode}: the Q-252-10 closure pass is an AFL Tables dry run`];
  }
  const problems = stepPostConditionProblems(step, where, null);
  if (!step.counters) return problems;
  for (const key of AFLTABLES_CLOSURE_NO_WRITE_COUNTERS) {
    const value = step.counters[key];
    if (typeof value !== 'number') problems.push(`${where}: counter ${key} is missing`);
    else if (value !== 0) problems.push(`${where}: ${key} = ${value}, must be 0 (no canonical mutation)`);
  }
  return problems;
}

/**
 * One AFL Tables result as the preparation record carries it (Q-252-10): the initial apply and
 * the closure dry run are written as two of these, never merged. `parsePreparationRecord()`
 * re-judges each from `counters` with the same guard the CLI ran.
 */
export function aflTablesStepEvidence(step: SettleStepSummary, batchId: string | number | null, result: string) {
  const counters = step.counters ?? {};
  return {
    source: step.source,
    mode: step.mode,
    batch_id: batchId,
    halt: step.halt,
    rollback_reason: step.rollbackReason,
    completeness: step.completeness,
    applied: step.applied,
    inserted: counters.canonicalRowsInserted ?? null,
    updated: counters.canonicalRowsUpdated ?? null,
    canonical_applications_logged: counters.canonicalApplicationsLogged ?? null,
    unresolved_identity_match: counters[AFLTABLES_FIRST_APPLY_TOLERATED_COUNTER] ?? null,
    /** The §21.2 zero list (on the initial apply, `unresolvedIdentityMatch` alone may be non-zero). */
    zero_list_counters: Object.fromEntries(PREPARATION_ZERO_COUNTERS.afltables.map((k) => [k, counters[k] ?? null])),
    result,
    counters: step.counters,
  };
}

function stepPostConditionProblems(step: SettleStepSummary, where: string, tolerated: string | null): string[] {
  const problems: string[] = [];
  if (step.halt) problems.push(`${where}: halted (${step.halt})`);
  // A dry run's own deliberate rollback (`'dry_run'`) is its expected outcome; any other reason,
  // or `'dry_run'` on an apply, is a STOP.
  const expectedRollback = step.mode === 'dry-run' && step.rollbackReason === 'dry_run';
  if (step.rollbackReason && !expectedRollback) problems.push(`${where}: rolled back (${step.rollbackReason})`);
  if (step.completeness !== 'complete') problems.push(`${where}: source completeness is ${String(step.completeness)}, not complete`);
  if (step.applied !== (step.mode === 'apply')) {
    problems.push(`${where}: expected ${step.mode === 'apply' ? 'a committed apply' : 'a rolled-back dry run'}, got applied=${step.applied}`);
  }
  if (!step.counters) return [...problems, `${where}: no counters were reported`];
  for (const key of PREPARATION_ZERO_COUNTERS[step.source]) {
    if (key === tolerated) continue;
    const value = step.counters[key];
    if (typeof value !== 'number') problems.push(`${where}: counter ${key} is missing`);
    else if (value !== 0) problems.push(`${where}: ${key} = ${value}, must be 0`);
  }
  return problems;
}

/**
 * D-252-7: the preparation CLI reads, and never writes, the ingestion switch. Both sessions
 * must be proved on `afldb_test` by `current_database()`, agree with each other, and the
 * switch must already be explicitly enabled by the operator's recorded lifecycle.
 */
export function preparationDatabaseProblems(input: {
  controlDatabase: string;
  importDatabase: string;
  aflApiCurrentSeasonEnabled: boolean | null;
}): string[] {
  const source = environmentNames('prod').source;
  const problems: string[] = [];
  if (input.controlDatabase !== source) problems.push(`DATABASE_URL session is '${input.controlDatabase}', not '${source}'`);
  if (input.importDatabase !== source) problems.push(`AFLDB_IMPORT_DATABASE_URL session is '${input.importDatabase}', not '${source}'`);
  if (input.controlDatabase !== input.importDatabase) {
    problems.push(`the control and import sessions disagree on current_database() ('${input.controlDatabase}' vs '${input.importDatabase}')`);
  }
  if (input.aflApiCurrentSeasonEnabled !== true) {
    problems.push(`acquisition.afl_api_current_season_enabled on ${source} is ${String(input.aflApiCurrentSeasonEnabled)}; `
      + 'the operator enables it explicitly (recording the prior value) before preparation — this tool never writes it');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// D-252-12: the AFL API canonical refusal census (replaces the aggregate-zero rule)
// ---------------------------------------------------------------------------

/**
 * The ONE refusal class an AFL API preparation settle may carry: the AFL API disagrees with an
 * existing `player_match_stats` row that AFL Tables owns. The canonical applier refused it at E3
 * (`foreign_source_owner`) against the owner it read in its savepoint; the row keeps AFL Tables'
 * values and `source_id`, and the refusal stays a durable `data_issues` finding. Acceptance is by
 * this exact class, row by row — never by a count, and never for any other reason, family, table
 * or owner.
 */
export const AFL_API_ACCEPTED_REFUSAL_CLASS = 'player_match_stats_foreign_source_owner_afltables';

const ACCEPTED_REFUSAL = {
  family: 'player_match_stats',
  target_table: 'player_match_stats',
  refusal: 'foreign_source_owner',
  owner_source_key: PREPARATION_SOURCE_ORDER[0],
} as const;

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Why one census entry is malformed or outside the accepted class; empty when it is accepted. */
export function aflApiRefusalEntryProblems(entry: unknown): string[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['a census entry is not an object'];
  const e = entry as Record<string, unknown>;
  const id = nonEmptyString(e.external_record_id) ? e.external_record_id : '(no external_record_id)';
  const problems: string[] = [];
  const keys = Object.keys(e).sort().join(',');
  if (keys !== 'external_record_id,family,match_key,owner_source_key,refusal,rendered_fields,target_table') {
    problems.push(`${id}: census entry fields are [${keys}]`);
  }
  for (const field of ['family', 'external_record_id', 'target_table', 'refusal', 'match_key'] as const) {
    if (!nonEmptyString(e[field])) problems.push(`${id}: ${field} is missing or empty`);
  }
  const fields = e.rendered_fields;
  if (!Array.isArray(fields) || fields.length === 0 || !fields.every(nonEmptyString)) {
    problems.push(`${id}: rendered_fields must be a non-empty list of field names`);
  } else if (fields.some((f, i) => i > 0 && !(fields[i - 1] < f))) {
    problems.push(`${id}: rendered_fields are not sorted and unique`);
  }
  if (e.owner_source_key !== null && !nonEmptyString(e.owner_source_key)) problems.push(`${id}: owner_source_key is malformed`);
  for (const [field, accepted] of Object.entries(ACCEPTED_REFUSAL)) {
    if (e[field] !== accepted) {
      problems.push(`${id}: ${field} is ${JSON.stringify(e[field] ?? null)}, the accepted class requires ${JSON.stringify(accepted)}`);
    }
  }
  return problems;
}

/**
 * The census against its counter: present, the same length as `canonicalApplyRefusals`, in the
 * canonical order with no duplicate, and every entry in the accepted class. Any problem is a STOP;
 * a census that cannot be shown complete is never assumed complete.
 */
export function aflApiRefusalCensusProblems(entries: unknown, canonicalApplyRefusals: unknown, where: string): string[] {
  if (!Array.isArray(entries)) return [`${where}: no refusal census was reported; canonicalApplyRefusals cannot be judged`];
  const problems: string[] = [];
  if (typeof canonicalApplyRefusals !== 'number' || !Number.isInteger(canonicalApplyRefusals) || canonicalApplyRefusals < 0) {
    problems.push(`${where}: counter canonicalApplyRefusals is missing or not a count`);
  } else if (canonicalApplyRefusals !== entries.length) {
    problems.push(`${where}: canonicalApplyRefusals = ${canonicalApplyRefusals} but the refusal census has ${entries.length} `
      + 'entr(ies); the census is not proven complete');
  }
  for (const entry of entries) problems.push(...aflApiRefusalEntryProblems(entry).map((p) => `${where}: refusal ${p}`));
  if (problems.length === 0) {
    const typed = entries as AflApiRefusalCensusEntry[];
    if (typed.some((e, i) => i > 0 && compareAflApiRefusalCensusEntries(typed[i - 1], e) >= 0)) {
      problems.push(`${where}: the refusal census is not in canonical order, or repeats an entry`);
    }
  }
  return problems;
}

/**
 * Dry run and apply must refuse exactly the same targets for exactly the same reasons. Compared by
 * canonical digest over stable identity; any added, removed or changed entry is a STOP.
 */
export function aflApiRefusalCensusParityProblems(
  dryRun: readonly AflApiRefusalCensusEntry[], apply: readonly AflApiRefusalCensusEntry[],
): string[] {
  const dry = aflApiRefusalCensusSha256(dryRun);
  const applied = aflApiRefusalCensusSha256(apply);
  if (dry === applied) return [];
  const text = (e: AflApiRefusalCensusEntry) => JSON.stringify(e);
  const drySet = new Set(dryRun.map(text));
  const applySet = new Set(apply.map(text));
  return [
    `afl_api refusal census changed between the dry run (${dryRun.length}, ${dry}) and the apply (${apply.length}, ${applied})`,
    ...[...applySet].filter((e) => !drySet.has(e)).map((e) => `  only in the apply: ${e}`),
    ...[...drySet].filter((e) => !applySet.has(e)).map((e) => `  only in the dry run: ${e}`),
  ];
}

/**
 * An AFL API preparation settle: every §21.2 post-condition, except that `canonicalApplyRefusals`
 * is judged by its classified census instead of by zero. Nothing else moves: every other zero-list
 * counter (collisions, unresolved identities, authority refusals, failures, ...) stays strict.
 */
export function aflApiPreparationStepProblems(step: SettleStepSummary): string[] {
  const where = `${step.source} ${step.mode}`;
  if (step.source !== 'afl_api') return [`${where}: the D-252-12 census judge covers the AFL API settle only`];
  const problems = stepPostConditionProblems(step, where, 'canonicalApplyRefusals');
  if (!step.counters) return problems;
  return [...problems, ...aflApiRefusalCensusProblems(step.refusalCensus, step.counters.canonicalApplyRefusals, where)];
}

/** The record's census section, from the dry-run and apply censuses the CLI already judged equal. */
export function aflApiRefusalCensusEvidence(
  dryRun: readonly AflApiRefusalCensusEntry[], apply: readonly AflApiRefusalCensusEntry[],
) {
  const sha256 = aflApiRefusalCensusSha256(apply);
  return {
    accepted_class: AFL_API_ACCEPTED_REFUSAL_CLASS,
    count: apply.length,
    sha256,
    dry_run: { count: dryRun.length, sha256: aflApiRefusalCensusSha256(dryRun) },
    apply: { count: apply.length, sha256 },
    entries: [...apply],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Re-judge a bound census from its entries alone: the class, the canonical order, the recomputed
 * digest and the count. An `accepted`-style flag is never read; there is none.
 */
export function aflApiRefusalCensusBindingOf(value: unknown, where: string): AflApiRefusalCensusBinding {
  if (!isRecord(value)) throw new Error(`${where} carries no AFL API refusal census (D-252-12).`);
  if (value.accepted_class !== AFL_API_ACCEPTED_REFUSAL_CLASS) {
    throw new Error(`${where}'s refusal census names class ${JSON.stringify(value.accepted_class ?? null)}, not '${AFL_API_ACCEPTED_REFUSAL_CLASS}'.`);
  }
  const problems = aflApiRefusalCensusProblems(value.entries, value.count, `${where}'s refusal census`);
  if (problems.length > 0) throw new Error(`${where}'s AFL API refusal census fails the D-252-12 contract:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  const entries = value.entries as AflApiRefusalCensusEntry[];
  const sha256 = aflApiRefusalCensusSha256(entries);
  if (value.sha256 !== sha256) throw new Error(`${where}'s refusal census sha256 ${String(value.sha256)} is not the recomputed ${sha256}.`);
  return { accepted_class: AFL_API_ACCEPTED_REFUSAL_CLASS, count: entries.length, sha256, entries: entries.map((e) => ({ ...e, rendered_fields: [...e.rendered_fields] })) };
}

// ---------------------------------------------------------------------------
// D-252-13: the current-season AFL API player bridge, a mandatory preparation prerequisite
// ---------------------------------------------------------------------------

/** The only bridge class preparation accepts: season evidence, bound to one retained snapshot. */
export const PLAYER_BRIDGE_MATCH_METHOD = AFL_API_SEASON_EVIDENCE_MATCH_METHOD;
export const PLAYER_BRIDGE_PREREQUISITE_KIND = 'afl_api_player_bridge_prerequisite';

/**
 * Offline: the named artefact is the recorded bytes, built for exactly this retained AFL API
 * snapshot and season, and its provider census is EXACTLY what the snapshot requires — every
 * required provider linked, none unresolved or contradictory, none extra. The loader
 * (`import_afl_api_player_bridge.ts`) separately enforces provenance, pinned inputs and the
 * stable-identity contract; this adds the binding to the retained input.
 */
export function playerBridgeArtefactProblems(input: {
  artefact: Record<string, unknown>;
  expectedFileSha256: string;
  actualFileSha256: string;
  aflApiLabel: string;
  aflApiManifestSha256: string;
  season: number;
  requiredProviderIds: readonly string[];
}): string[] {
  const a = input.artefact;
  const problems = hashBindingProblems('player bridge artefact', 'afl_api player bridge', input.expectedFileSha256, input.actualFileSha256);
  if (a.match_method !== PLAYER_BRIDGE_MATCH_METHOD) {
    problems.push(`match_method is ${JSON.stringify(a.match_method ?? null)}; preparation accepts only '${PLAYER_BRIDGE_MATCH_METHOD}' season evidence`);
  }
  if (a.snapshot_label !== input.aflApiLabel) {
    problems.push(`the bridge was built for snapshot ${JSON.stringify(a.snapshot_label ?? null)}, not the retained '${input.aflApiLabel}'`);
  }
  if (a.snapshot_manifest_sha256 !== input.aflApiManifestSha256) {
    problems.push(`the bridge names snapshot manifest ${JSON.stringify(a.snapshot_manifest_sha256 ?? null)}, not the verified ${input.aflApiManifestSha256}`);
  }
  if (a.season !== input.season) problems.push(`the bridge is for season ${JSON.stringify(a.season ?? null)}, not ${input.season}`);
  if (input.requiredProviderIds.length === 0) problems.push('the retained AFL API snapshot requires no provider player; nothing can be proven');
  const providers = isRecord(a.providers) ? a.providers : null;
  if (!providers) return [...problems, 'the bridge carries no providers map'];
  const required = new Set(input.requiredProviderIds);
  const missing = input.requiredProviderIds.filter((id) => !Object.prototype.hasOwnProperty.call(providers, id));
  const extra = Object.keys(providers).filter((id) => !required.has(id)).sort();
  if (missing.length > 0) problems.push(`${missing.length} required provider(s) are absent from the bridge: ${missing.join(', ')}`);
  if (extra.length > 0) problems.push(`${extra.length} provider(s) in the bridge are not required by the snapshot: ${extra.join(', ')}`);
  for (const id of input.requiredProviderIds) {
    const row = providers[id];
    if (!isRecord(row)) continue;
    if (row.disposition !== 'linked') problems.push(`${id}: disposition ${JSON.stringify(row.disposition ?? null)}, must be 'linked'`);
    else if (!nonEmptyString(row.candidate_player_identity)) problems.push(`${id}: no candidate_player_identity (a numeric id alone is never accepted)`);
  }
  return problems;
}

/** What preparation reads from an import report (a subset of `BridgeImportReport`). */
export type PlayerBridgeImportCounts = {
  outcome: string;
  linked: number;
  alreadyLinked: number;
  alreadyLinkedHuman: number;
  contradictionsWithheld: readonly string[];
  playerCollisionsWithheld: readonly string[];
  findingsRecorded: number;
  findingsAlreadyOpen: number;
  stops: readonly unknown[];
  hintMismatches: readonly unknown[];
  importBatchId: string | null;
};

/** The loader's report: no stop, contradiction, collision or finding, and every required row accounted for. */
export function playerBridgeImportProblems(report: PlayerBridgeImportCounts, expectedOutcome: 'READ_ONLY' | 'COMMITTED', required: number): string[] {
  const where = `player bridge ${expectedOutcome === 'COMMITTED' ? 'apply' : 'validation'}`;
  const problems: string[] = [];
  if (report.outcome !== expectedOutcome) problems.push(`${where}: outcome ${report.outcome}, expected ${expectedOutcome}`);
  if (report.stops.length > 0) problems.push(`${where}: ${report.stops.length} provider(s) do not resolve through their stable identity`);
  if (report.contradictionsWithheld.length > 0) problems.push(`${where}: contradictions withheld: ${report.contradictionsWithheld.join(', ')}`);
  if (report.playerCollisionsWithheld.length > 0) problems.push(`${where}: player collisions withheld: ${report.playerCollisionsWithheld.join(', ')}`);
  if (report.findingsRecorded + report.findingsAlreadyOpen > 0) {
    problems.push(`${where}: ${report.findingsRecorded + report.findingsAlreadyOpen} bridge finding(s); a clean prerequisite has none`);
  }
  const accounted = report.linked + report.alreadyLinked + report.alreadyLinkedHuman;
  if (accounted !== required) problems.push(`${where}: ${accounted} provider(s) linked or already linked, but the snapshot requires ${required}`);
  if (expectedOutcome === 'COMMITTED' && !(typeof report.importBatchId === 'string' && /^[1-9][0-9]*$/.test(report.importBatchId))) {
    problems.push(`${where}: no import batch was recorded`);
  }
  return problems;
}

export type PlayerBridgeIdentityRow = { externalId: string; status: string; playerId: number | null };

/**
 * Immediately after the apply, read back: every required provider holds exactly one linked
 * `afl_api` identity. Human `resolved` rows are accepted only in the number the loader already
 * found (the rebuild's own ISSUE-235 state); the bridge never introduces human authority.
 */
export function playerBridgePostApplyProblems(
  requiredProviderIds: readonly string[], rows: readonly PlayerBridgeIdentityRow[], humanAlreadyLinked: number,
): string[] {
  const byId = new Map<string, PlayerBridgeIdentityRow[]>();
  for (const row of rows) byId.set(row.externalId, [...(byId.get(row.externalId) ?? []), row]);
  const problems: string[] = [];
  let human = 0;
  for (const id of requiredProviderIds) {
    const held = byId.get(id) ?? [];
    if (held.length !== 1) { problems.push(`${id}: ${held.length} afl_api identity row(s), expected exactly 1`); continue; }
    const [row] = held;
    if (row.playerId === null) problems.push(`${id}: not linked to a player (status ${row.status})`);
    else if (row.status === 'resolved') human += 1;
    else if (row.status !== 'unique') problems.push(`${id}: status ${row.status}, not a link`);
  }
  if (human !== humanAlreadyLinked) {
    problems.push(`${human} required provider(s) hold a human 'resolved' link, but the loader found ${humanAlreadyLinked} beforehand; `
      + 'the bridge never introduces human authority');
  }
  return problems;
}

/** The record's bridge section, re-judged whole on every parse. */
export function playerBridgeBindingOf(value: unknown, expected: {
  aflApiLabel: string; aflApiManifestSha256: string; season: number;
}): PlayerBridgeBinding {
  const where = 'The preparation record\'s player bridge';
  if (!isRecord(value) || value.kind !== PLAYER_BRIDGE_PREREQUISITE_KIND) {
    throw new Error(`The preparation record carries no AFL API player bridge prerequisite (D-252-13).`);
  }
  const artefact = isRecord(value.artefact) ? value.artefact : {};
  const census = isRecord(value.provider_census) ? value.provider_census : {};
  const post = isRecord(value.post_apply) ? value.post_apply : {};
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const required = count(census.required);
  const problems: string[] = [];
  if (!HEX64.test(String(artefact.file_sha256))) problems.push('artefact file_sha256 is not 64 lowercase hex');
  if (artefact.match_method !== PLAYER_BRIDGE_MATCH_METHOD) problems.push(`match_method is ${JSON.stringify(artefact.match_method ?? null)}`);
  if (artefact.snapshot_label !== expected.aflApiLabel) problems.push(`built for snapshot ${JSON.stringify(artefact.snapshot_label ?? null)}, not '${expected.aflApiLabel}'`);
  if (artefact.snapshot_manifest_sha256 !== expected.aflApiManifestSha256) problems.push('built for another AFL API snapshot manifest');
  if (artefact.season !== expected.season) problems.push(`built for season ${JSON.stringify(artefact.season ?? null)}`);
  if (required === null || required === 0) problems.push('no required provider census');
  if (count(census.artefact_providers) !== required || count(census.artefact_linked) !== required) {
    problems.push('the artefact provider census is not exactly the required census');
  }
  for (const phase of ['validate', 'apply'] as const) {
    const r = isRecord(value[phase]) ? value[phase] as Record<string, unknown> : null;
    const list = (v: unknown) => (Array.isArray(v) ? v : ['(unreadable)']);
    const report = r === null ? null : {
      outcome: String(r.outcome), linked: Number(r.linked), alreadyLinked: Number(r.already_linked),
      alreadyLinkedHuman: Number(r.already_linked_human), contradictionsWithheld: list(r.contradictions_withheld),
      playerCollisionsWithheld: list(r.player_collisions_withheld), findingsRecorded: Number(r.findings_recorded),
      findingsAlreadyOpen: Number(r.findings_already_open), stops: list(r.stops), hintMismatches: [],
      importBatchId: typeof r.import_batch_id === 'string' ? r.import_batch_id : null,
    };
    if (report === null) problems.push(`no ${phase} report`);
    else problems.push(...playerBridgeImportProblems(report, phase === 'apply' ? 'COMMITTED' : 'READ_ONLY', required ?? -1));
  }
  if (count(post.required) !== required || count(post.linked) !== required || post.unlinked !== 0) {
    problems.push('the post-apply read-back does not show every required provider linked');
  }
  if (problems.length > 0) throw new Error(`${where} fails the D-252-13 contract:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  const applyReport = value.apply as Record<string, unknown>;
  return {
    file_sha256: String(artefact.file_sha256),
    match_method: PLAYER_BRIDGE_MATCH_METHOD,
    snapshot_label: expected.aflApiLabel,
    snapshot_manifest_sha256: expected.aflApiManifestSha256,
    required_providers: required as number,
    linked_providers: count(post.linked) as number,
    import_batch_id: Number(applyReport.import_batch_id),
  };
}

/** The proof's copy of the bridge binding: structurally whole and self-consistent. */
function proofBridgeProblems(b: PlayerBridgeBinding | undefined, afl: PreparationBinding['afl_api'] | undefined): string[] {
  if (!b || !afl) return ['no AFL API player bridge binding'];
  const problems: string[] = [];
  if (!HEX64.test(String(b.file_sha256))) problems.push('bridge file_sha256 is malformed');
  if (b.match_method !== PLAYER_BRIDGE_MATCH_METHOD) problems.push('bridge match_method is not season evidence');
  if (b.snapshot_label !== afl.label || b.snapshot_manifest_sha256 !== afl.manifest_sha256) problems.push('bridge is not bound to the preparation\'s AFL API snapshot');
  if (!Number.isInteger(b.required_providers) || b.required_providers <= 0 || b.linked_providers !== b.required_providers) {
    problems.push('bridge does not show every required provider linked');
  }
  if (!Number.isSafeInteger(b.import_batch_id) || b.import_batch_id <= 0) problems.push('bridge import batch is malformed');
  return problems;
}
