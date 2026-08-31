/**
 * AFLDB-ISSUE-100 L2 — the `afl_api.lineup` observation bundle emitter.
 *
 * Turns one bounded `fetch_lineup_afl(season, round_number)` acquisition into
 * the deterministic observation bundle that AFLDB-ISSUE-099 already defined
 * (`tools/migration/import_fitzroy_core.py` emits it, `settle-afltables.ts`
 * parses it). The FORMAT is that existing contract; only this family's
 * identity, scope and completeness rules are new, and each is family-local by
 * decision rather than a new repository-wide abstraction.
 *
 * **Staging-only, and nothing here resolves anything.** No match, club or
 * player is resolved to an AFLDB id, no participation is asserted, no
 * projection is produced and no database is touched — this module imports no
 * driver and opens no connection. An announced player is not a player who
 * played, and this file is deliberately incapable of saying otherwise.
 *
 * Three contracts are pinned here, all three family-local to `afl_api.lineup`:
 *
 *   1. `external_record_id` = `providerId|teamId|player.playerId`, in declared
 *      `external_key` order. This is NOT a universal repository encoder:
 *      `afltables.match` uses `|` because it inherits the canonical
 *      `matches.match_key`, and `afltables.player_match_stats` uses `@` around
 *      one. This family owns its own encoding and refuses — never escapes —
 *      a component containing the delimiter.
 *   2. `scope_key` = `season=<int>;round=<int>`, the real grain of one
 *      acquisition. A season-only scope would overstate what one fetch
 *      enumerated.
 *   3. Every enumeration is `complete: false`, permanently in v1. P3b proved
 *      fixture-to-lineup MATCH-SET equality, which proves every fixture was
 *      queried; it does not establish that the player rows for a team are
 *      complete on every run. Absence sweeping is therefore disabled for this
 *      family and there is no flag that turns it on.
 */
import {
  assertProjectableColumns,
  type SourceFamilyContract,
} from './source-families';
import { canonicalJson, type JsonValue } from './observations';

export class LineupBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineupBundleError';
  }
}

function fail(message: string): never {
  throw new LineupBundleError(message);
}

/** The wire names this family uses inside the bundle. */
export const LINEUP_SOURCE_KEY = 'afl_api';
export const LINEUP_FAMILY = 'lineup';

/**
 * The bundle schema version this emitter writes. It is the ISSUE-099 bundle
 * contract; this family adds no field to it.
 */
export const LINEUP_BUNDLE_CONTRACT_VERSION = 1;

/**
 * The family-local composite delimiter. Declared as a constant so the refusal
 * below and the encoder can never drift apart.
 */
export const LINEUP_KEY_DELIMITER = '|';

/**
 * The one reason string every `afl_api.lineup` enumeration carries. It is
 * fixed, not computed, because the incompleteness is a property of the source
 * contract rather than of any particular run.
 */
export const LINEUP_INCOMPLETE_REASON =
  'row-grain lineup completeness is not contractually established; '
  + 'afl_api.lineup is intentionally incomplete for absence purposes; '
  + 'absence sweeping is disabled for this family';

/** One raw source row, exactly as the acquisition artefact carried it. */
export type LineupSourceRow = Readonly<Record<string, JsonValue>>;

export type LineupBundleInput = {
  /** The completed `afl_api`/`lineup` contract from the source-family registry. */
  contract: SourceFamilyContract;
  season: number;
  roundNumber: number;
  /** The column set the acquisition observed, in source order. */
  observedColumns: readonly string[];
  rows: readonly LineupSourceRow[];
  /** Provenance of the artefact these rows were read from. */
  acquisition: LineupAcquisitionRef;
};

/**
 * The acquisition the bundle was built from. This is provenance, not payload:
 * it names the artefact and binds its hash, and nothing in it participates in
 * an observation's identity or in a payload hash.
 */
export type LineupAcquisitionRef = {
  snapshotLabel: string;
  manifestPath: string;
  manifestSha256: string;
  artefactSha256: string;
  acquisitionKind: string;
  fitzroyVersion: string | null;
};

export type LineupBundleRecord = {
  family: string;
  scope_key: string;
  external_record_id: string;
  payload: Record<string, JsonValue>;
  observed_columns: readonly string[];
  /** Always null: L2 resolves nothing and projects nothing. */
  projection: null;
  /** Always null: an unencodable row refuses the whole bundle instead. */
  rejection: null;
};

export type LineupBundleEnumeration = {
  family: string;
  scope_key: string;
  complete: false;
  incomplete_reason: string;
  external_record_ids: readonly string[];
};

export type LineupBundle = {
  bundle_contract_version: number;
  generated_by: string;
  snapshot_label: string;
  manifest_path: string;
  manifest_sha256: string;
  artefact_sha256: string;
  acquisition_kind: string;
  source_key: string;
  season: number;
  round_number: number;
  fitzroy_version: string | null;
  enumerations: readonly LineupBundleEnumeration[];
  records: readonly LineupBundleRecord[];
  /** Present for bundle-shape parity; this family never emits one. */
  unkeyed_rejections: readonly never[];
  counts: {
    lineup_rows: number;
    records: number;
    rejections: number;
    unkeyed_rejections: number;
  };
};

/**
 * `season=<int>;round=<int>` — the real grain of one acquisition.
 *
 * The grammar is pinned rather than parsed from caller text: both components
 * are controlled integers, so there is no free-form scope string to sanitise
 * and no arbitrary key/value pair to accept. There is deliberately no "latest"
 * or implicit round.
 */
export function lineupScopeKey(season: number, roundNumber: number): string {
  assertPlainInteger(season, 'season');
  assertPlainInteger(roundNumber, 'round');
  // A season outside this range is a caller defect, not a source observation:
  // AFLDB's first season is 1897 and a plausible upper bound keeps a typo or a
  // millisecond timestamp from silently becoming a scope.
  if (season < 1897 || season > 2200) {
    fail(`A lineup scope season must be within 1897-2200, found ${season}.`);
  }
  if (roundNumber < 0) {
    fail(`A lineup scope round must not be negative, found ${roundNumber}.`);
  }
  return `season=${season};round=${roundNumber}`;
}

function assertPlainInteger(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`A lineup scope ${label} must be an integer, found ${JSON.stringify(value)}.`);
  }
}

/**
 * `providerId|teamId|player.playerId`, in the order the registry declares.
 *
 * The components are read from the contract's own `external_key`, so the
 * encoding cannot drift from the declaration. Every component must be present,
 * must be a non-blank string, and must not contain the delimiter: a component
 * carrying a `|` REFUSES rather than being escaped, replaced or hashed. That
 * assertion is what makes the encoding structurally unambiguous, instead of
 * relying on the currently observed `CD_*` namespace holding forever.
 *
 * Player names are never consulted. They are payload evidence and are not
 * identity at any grain.
 */
export function lineupExternalRecordId(
  contract: SourceFamilyContract, row: LineupSourceRow,
): string {
  const keyColumns = contract.externalKey;
  if (keyColumns === null || keyColumns.length === 0) {
    fail(`${contract.sourceKey}/${contract.family} declares no external key.`);
  }
  const parts = keyColumns.map((column) => {
    if (!(column in row)) {
      fail(`A lineup row is missing external-key column '${column}'.`);
    }
    const value = row[column];
    if (typeof value !== 'string') {
      fail(
        `Lineup external-key column '${column}' must be a string, found `
        + `${value === null ? 'null' : typeof value}.`,
      );
    }
    if (value.trim() === '') {
      fail(`Lineup external-key column '${column}' is blank.`);
    }
    if (value.includes(LINEUP_KEY_DELIMITER)) {
      fail(
        `Lineup external-key column '${column}' contains the '${LINEUP_KEY_DELIMITER}' `
        + 'delimiter, so the composite key would be ambiguous. Refusing: the delimiter is '
        + 'never escaped, replaced or hashed.',
      );
    }
    return value;
  });
  return parts.join(LINEUP_KEY_DELIMITER);
}

/**
 * The raw observation payload for one source row.
 *
 * Fidelity is the whole job. Every declared column the row actually supplied is
 * carried through unchanged: `lateChanges` keeps its exact text (and is
 * repeated across a team's rows exactly as the provider repeats it),
 * `player.captain` keeps its raw `false`, a jumper number stays an integer, and
 * NULL, false, 0 and "" stay four distinct values.
 *
 * A column the provider omitted from the whole payload is ABSENT from the
 * payload object; a column present with an NA value is present with `null`.
 * Those are different observations and the bundle keeps them different — the
 * emitter never fabricates `""` and never fabricates `null` to square up
 * shapes.
 */
export function lineupPayload(
  row: LineupSourceRow, observedColumns: readonly string[],
): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {};
  for (const column of observedColumns) {
    // `in` rather than a truthiness or undefined test: a column present with a
    // null value must stay present-and-null.
    if (column in row) payload[column] = row[column];
  }
  return payload;
}

/**
 * Build the bundle. Shape is validated through the S1 projection gate first, so
 * an undeclared column or a missing required one refuses before any record is
 * built — the gate itself is untouched and is not weakened here.
 */
export function buildLineupBundle(input: LineupBundleInput): LineupBundle {
  const { contract, season, roundNumber, observedColumns, rows, acquisition } = input;
  if (contract.sourceKey !== LINEUP_SOURCE_KEY || contract.family !== LINEUP_FAMILY) {
    fail(
      `This emitter builds ${LINEUP_SOURCE_KEY}/${LINEUP_FAMILY} bundles only, but was `
      + `given ${contract.sourceKey}/${contract.family}.`,
    );
  }
  // Both proven shapes pass here: the 20-column round-20 set and the same set
  // without the conditional `lateChanges`. A 21st column refuses.
  assertProjectableColumns(contract, observedColumns);

  const scopeKey = lineupScopeKey(season, roundNumber);
  const seen = new Map<string, number>();
  const records: LineupBundleRecord[] = rows.map((row, i) => {
    const externalRecordId = lineupExternalRecordId(contract, row);
    const previous = seen.get(externalRecordId);
    if (previous !== undefined) {
      fail(
        `Lineup rows ${previous} and ${i} share external record id '${externalRecordId}'. `
        + 'The declared external key must be unique at row grain.',
      );
    }
    seen.set(externalRecordId, i);
    return {
      family: LINEUP_FAMILY,
      scope_key: scopeKey,
      external_record_id: externalRecordId,
      payload: lineupPayload(row, observedColumns),
      observed_columns: [...observedColumns],
      projection: null,
      rejection: null,
    };
  });

  // Sorted by (family, external_record_id), exactly as the ISSUE-099 emitter
  // sorts its records. Source row order is therefore not carried, which is what
  // makes a reordered input produce an identical bundle.
  const ordered = [...records].sort((a, b) => (
    a.family < b.family ? -1 : a.family > b.family ? 1
      : a.external_record_id < b.external_record_id ? -1
        : a.external_record_id > b.external_record_id ? 1 : 0
  ));

  return {
    bundle_contract_version: LINEUP_BUNDLE_CONTRACT_VERSION,
    generated_by: 'src/lib/acquisition/lineup-bundle.ts',
    snapshot_label: acquisition.snapshotLabel,
    manifest_path: acquisition.manifestPath,
    manifest_sha256: acquisition.manifestSha256,
    artefact_sha256: acquisition.artefactSha256,
    acquisition_kind: acquisition.acquisitionKind,
    source_key: LINEUP_SOURCE_KEY,
    season,
    round_number: roundNumber,
    fitzroy_version: acquisition.fitzroyVersion,
    enumerations: [lineupEnumeration(scopeKey, ordered)],
    records: ordered,
    unkeyed_rejections: [],
    counts: {
      lineup_rows: rows.length,
      records: ordered.length,
      rejections: 0,
      unkeyed_rejections: 0,
    },
  };
}

/**
 * The one enumeration for this scope. `complete` is the literal `false` — not a
 * computed value, not a parameter and not a flag — so no run, no caller and no
 * future option can declare an `afl_api.lineup` scope sweepable.
 */
function lineupEnumeration(
  scopeKey: string, records: readonly LineupBundleRecord[],
): LineupBundleEnumeration {
  return {
    family: LINEUP_FAMILY,
    scope_key: scopeKey,
    complete: false,
    incomplete_reason: LINEUP_INCOMPLETE_REASON,
    external_record_ids: [...records.map((r) => r.external_record_id)].sort(),
  };
}

/**
 * The bundle's deterministic serialisation, reusing `canonicalJson` so nothing
 * here invents a second canonical form. Identical semantic content yields
 * byte-identical output regardless of source row order or key order.
 */
export function serialiseLineupBundle(bundle: LineupBundle): string {
  return `${canonicalJson(bundle as unknown as JsonValue)}\n`;
}

/**
 * Assemble emitter input from an acquisition's two artefacts.
 *
 * Pure: the caller does the filesystem read, so this stays unit-testable and
 * database-free. It performs NO type coercion — the artefact is JSON precisely
 * so that character, integer, logical and null arrive already correct — and it
 * takes the observed column set from the manifest, which recorded it in source
 * order at acquisition time, rather than re-deriving it from row keys where an
 * all-null column could vanish.
 */
export function lineupAcquisitionInput(
  contract: SourceFamilyContract, manifest: unknown, artefact: unknown,
): LineupBundleInput {
  const m = asRecord(manifest, 'manifest');
  if (m.source_key !== LINEUP_SOURCE_KEY || m.family !== LINEUP_FAMILY) {
    fail(
      `This manifest is for ${String(m.source_key)}/${String(m.family)}, not `
      + `${LINEUP_SOURCE_KEY}/${LINEUP_FAMILY}.`,
    );
  }
  const season = m.season;
  const roundNumber = m.round_number;
  if (typeof season !== 'number' || typeof roundNumber !== 'number') {
    fail('The manifest must carry a numeric season and round_number.');
  }
  const observedColumns = m.observed_columns;
  if (!Array.isArray(observedColumns) || observedColumns.some((c) => typeof c !== 'string')) {
    fail('The manifest must carry observed_columns as an array of strings.');
  }
  if (!Array.isArray(artefact)) {
    fail('The lineup artefact must be an array of source rows.');
  }
  const files = Array.isArray(m.files) ? m.files : [];
  const artefactSha256 = files.length === 1 && typeof asRecord(files[0], 'files[0]').sha256 === 'string'
    ? String(asRecord(files[0], 'files[0]').sha256)
    : fail('The manifest must name exactly one artefact file with a sha256.');

  return {
    contract,
    season,
    roundNumber,
    observedColumns: observedColumns as readonly string[],
    rows: artefact.map((entry, i) => asRecord(entry, `artefact[${i}]`) as LineupSourceRow),
    acquisition: {
      snapshotLabel: String(m.snapshot_label ?? ''),
      manifestPath: String(m.working_directory ?? ''),
      manifestSha256: String(m.manifest_sha256 ?? ''),
      artefactSha256,
      acquisitionKind: String(m.acquisition_kind ?? ''),
      fitzroyVersion: typeof m.fitzroy_version_pinned === 'string'
        ? m.fitzroy_version_pinned
        : null,
    },
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
