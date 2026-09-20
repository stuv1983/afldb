/**
 * AFLDB-ISSUE-096 S1 — the source-family acquisition contract.
 *
 * Parses and validates `data/reference/source-families.json`, the tracked
 * declaration of how each external source's data families may be observed:
 * external key shape, payload-hash exclusions, required/known columns, round
 * vocabulary, independence group and promotion policy.
 *
 * Three rules shape this module:
 *
 *   1. Stable source KEYS only. A database-local `sources.id` never appears in
 *      a tracked contract, so nothing here resolves or stores a numeric id.
 *   2. Fail closed. Every drift — an undeclared family, a missing required
 *      column, an unexpected column, an unknown round vocabulary, a derived
 *      source claiming its own independence group — throws. There is no
 *      permissive fallback and no force flag.
 *   3. Pure. No filesystem, no database, no network: the caller supplies the
 *      already-parsed JSON. That keeps the contract testable without a
 *      database and safe to reuse from tooling and from server code alike.
 *
 * Reconciliation verbs, payload hashing and the promotion transaction are
 * stages S2–S4 and deliberately live elsewhere.
 */

import { FIXTURE_ROUND_TYPES, type FixtureRoundType } from '@/lib/fixtures/spec';

export class SourceFamilyContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFamilyContractError';
  }
}

export type SourceRegistrationKind = 'reference_dataset' | 'migration' | 'unregistered';

/**
 * `declared` — key shape and column contract are proven, so the family can be
 * projected. `identity_only` — the source and its independence group are
 * known but the shape is not, so nothing may be projected or promoted.
 */
export type FamilyStatus = 'declared' | 'identity_only';

export type KnownColumnsStatus = 'complete' | 'incomplete' | 'undeclared';

export type IndependenceEvidence =
  | 'proven_independent'
  | 'proven_derived'
  | 'assumed_derived_pending_probe';

export type PromotionPolicy = 'never' | 'reviewed' | 'not_yet_declared';

/**
 * AFLDB-ISSUE-122 §10 — what a DISAGREEING independence group does to this
 * family's own proposal.
 *
 * `blocking` is the ISSUE-096 behaviour and stays the default for every
 * family that does not declare otherwise: any disagreeing group refuses the
 * proposal outright. `advisory` removes the veto and nothing else — the
 * corroboration report is still computed, `agreeing_groups` /
 * `disagreeing_groups` are still recorded on the ledger row, and the
 * `source_disagreement` `data_issues` row is still opened and deduplicated.
 * Evidence is preserved; only the refusal is withdrawn.
 *
 * Declared `advisory` for `afltables`/`match` and `afltables`/
 * `player_match_stats` (approved decision 5): Squiggle and Kali are being
 * retired and must never become a prerequisite for an AFL Tables canonical
 * write, nor be able to veto one.
 */
export type CorroborationPolicy = 'blocking' | 'advisory';

export type RoundMappingStatus = 'anchors_only' | 'complete' | 'declared';

export type SourceRegistration = {
  key: string;
  registeredBy: SourceRegistrationKind;
  registeredIn: string | null;
  registrationOwner: string | null;
  notes: readonly string[];
};

export type RoundAnchor = {
  roundNumber: number;
  meaning: string;
  evidence: string;
};

export type AnchorRoundVocabulary = {
  key: string;
  shape: 'anchors';
  description: string;
  mappingStatus: 'anchors_only' | 'complete';
  mappingOwner: string | null;
  anchors: readonly RoundAnchor[];
};

/**
 * AFLDB-ISSUE-228 §6.4 — a fully explicit, per-season round table. Unlike
 * `AnchorRoundVocabulary`, this shape carries every round the source
 * publishes for one season, so it can actually DRIVE a translation
 * (`translateAflRound()` in `afl-api-rounds.ts`) rather than just prove two
 * anchor points. `mappingStatus` is always `'declared'` for this shape; it is
 * a distinct value from `'complete'` because nothing here feeds the generic
 * cross-vocabulary `translateRound()` below, which stays refused for it.
 */
export type DeclaredRoundVocabulary = {
  key: string;
  shape: 'declared';
  description: string;
  mappingStatus: 'declared';
  season: number;
  evidence: readonly string[];
  rounds: readonly DeclaredRoundRow[];
};

export type RoundVocabulary = AnchorRoundVocabulary | DeclaredRoundVocabulary;

/**
 * `round_type` exactly as the DB enum and `@/lib/fixtures/spec` declare it,
 * plus the one JSON-only sentinel `'mixed_finals'` for a round whose
 * `api_round_number` covers more than one real `round_type` (AFL's combined
 * Qualifying & Elimination Finals round) and therefore needs
 * `finalsLabelRules` to resolve one. `'mixed_finals'` is never a value
 * `translateAflRound()` returns; it only ever appears in the declared table.
 */
export type DeclaredRoundType = FixtureRoundType | 'mixed_finals';

/** A `mixed_finals` row's rule for choosing a real `round_type` from the
 * match's own `metadata.finals_match_label`. `roundType` is never
 * `'home_and_away'` or `'mixed_finals'` itself — a rule always resolves to
 * one concrete finals type. */
export type FinalsLabelRule = {
  contains: string;
  roundType: Exclude<FixtureRoundType, 'home_and_away'>;
};

export type DeclaredRoundRow = {
  apiRoundNumber: number;
  apiAbbreviation: string;
  apiName: string;
  roundType: DeclaredRoundType;
  /** Present only for `round_type: 'home_and_away'`; null otherwise (a final
   * carries no round number, matching `matches_round_number_ck`). */
  canonicalRoundNumber: number | null;
  /** Present only for `round_type: 'mixed_finals'`; null otherwise. */
  finalsLabelRules: readonly FinalsLabelRule[] | null;
};

export type FamilyIndependence = {
  derivesFrom: string | null;
  group: string;
  evidence: IndependenceEvidence;
};

export type SourceFamilyContract = {
  sourceKey: string;
  family: string;
  endpoint: string;
  status: FamilyStatus;
  externalKey: readonly string[] | null;
  requiredColumns: readonly string[] | null;
  knownColumns: readonly string[] | null;
  knownColumnsStatus: KnownColumnsStatus;
  hashExclusions: readonly string[];
  sourceUpdatedAtField: string | null;
  zeroIsMissingColumns: readonly string[];
  roundVocabulary: string | null;
  independence: FamilyIndependence;
  promotionPolicy: PromotionPolicy;
  promotionOwner: string | null;
  /** Optional in the JSON; absent reads as `blocking` (ISSUE-122 §10). */
  corroborationPolicy: CorroborationPolicy;
  evidence: readonly string[];
  notes: readonly string[];
};

export type SourceFamilyRegistry = {
  contractVersion: number;
  sources: ReadonlyMap<string, SourceRegistration>;
  roundVocabularies: ReadonlyMap<string, RoundVocabulary>;
  families: readonly SourceFamilyContract[];
  /**
   * AFLDB-ISSUE-228 §7.5 (Q1) — groups of source keys declared co-sources for
   * the canonical targets they jointly propose. A co-source-owned row is
   * CORROBORATED, never refused and never re-owned; every other combination
   * of owner/proposer stays an ordinary foreign-owner refusal. Each group is
   * sorted and deduplicated; a source key appears in at most one group.
   */
  coSourceGroups: readonly (readonly string[])[];
};

export type RoundKey = {
  vocabulary: string;
  roundNumber: number | null;
  roundLabel: string | null;
};

const CONTRACT_VERSION = 1;

const REGISTRATION_KINDS: readonly SourceRegistrationKind[] = [
  'reference_dataset', 'migration', 'unregistered',
];
const FAMILY_STATUSES: readonly FamilyStatus[] = ['declared', 'identity_only'];
const KNOWN_COLUMN_STATUSES: readonly KnownColumnsStatus[] = ['complete', 'incomplete', 'undeclared'];
const INDEPENDENCE_EVIDENCE: readonly IndependenceEvidence[] = [
  'proven_independent', 'proven_derived', 'assumed_derived_pending_probe',
];
const PROMOTION_POLICIES: readonly PromotionPolicy[] = ['never', 'reviewed', 'not_yet_declared'];
const CORROBORATION_POLICIES: readonly CorroborationPolicy[] = ['blocking', 'advisory'];

/** The fail-closed reading of an undeclared family (ISSUE-122 §10). */
export const DEFAULT_CORROBORATION_POLICY: CorroborationPolicy = 'blocking';
const ROUND_MAPPING_STATUSES: readonly RoundMappingStatus[] = ['anchors_only', 'complete', 'declared'];
const DECLARED_ROUND_TYPES: readonly DeclaredRoundType[] = [...FIXTURE_ROUND_TYPES, 'mixed_finals'];
const FINALS_LABEL_ROUND_TYPES: readonly Exclude<FixtureRoundType, 'home_and_away'>[] =
  FIXTURE_ROUND_TYPES.filter((t): t is Exclude<FixtureRoundType, 'home_and_away'> => t !== 'home_and_away');

const SOURCE_KEYS = ['registered_by', 'registered_in', 'registration_owner', 'notes'];
const VOCABULARY_KEYS = ['description', 'mapping_status', 'mapping_owner', 'anchors'];
const ANCHOR_KEYS = ['round_number', 'meaning', 'evidence'];
const DECLARED_VOCABULARY_KEYS = ['description', 'mapping_status', 'season', 'evidence', 'rounds'];
const DECLARED_ROUND_ROW_KEYS = [
  'api_round_number', 'api_abbreviation', 'api_name', 'round_type',
  'canonical_round_number', 'finals_label_rules',
];
const OPTIONAL_DECLARED_ROUND_ROW_KEYS = ['canonical_round_number', 'finals_label_rules'];
const FINALS_LABEL_RULE_KEYS = ['contains', 'round_type'];
const INDEPENDENCE_KEYS = ['derives_from', 'group', 'evidence'];
const FAMILY_KEYS = [
  'source_key', 'family', 'endpoint', 'status', 'external_key', 'required_columns',
  'known_columns', 'known_columns_status', 'hash_exclusions', 'source_updated_at_field',
  'zero_is_missing_columns', 'round_vocabulary', 'independence', 'promotion_policy',
  'promotion_owner', 'corroboration_policy', 'evidence', 'notes',
];
/**
 * Keys a family MAY omit. `expectKeys` otherwise requires every declared key,
 * which is the fail-closed default and stays that way: `corroboration_policy`
 * is optional only because an absent one has an unambiguous, strictly
 * fail-closed reading (`blocking`), so the existing families keep today's
 * behaviour with no edit (ISSUE-122 §10).
 */
const OPTIONAL_FAMILY_KEYS = ['corroboration_policy'];
const ROOT_KEYS = [
  '$comment', 'contract_version', 'sources', 'round_vocabularies', 'families', 'co_source_groups',
];
/** AFLDB-ISSUE-228 §7.5 (Q1). Optional: a registry with no declared co-source
 * group (every family issue before ISSUE-228) reads as an empty list, same
 * as an absent `corroboration_policy` reads as `blocking`. */
const OPTIONAL_ROOT_KEYS = ['co_source_groups'];

function fail(message: string): never {
  throw new SourceFamilyContractError(message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** An unexpected key is drift, so the registry refuses rather than ignoring it. */
function expectKeys(
  row: Record<string, unknown>, allowed: readonly string[], path: string,
  optional: readonly string[] = [],
): void {
  const unexpected = Object.keys(row).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail(`${path} carries unexpected key(s): ${unexpected.sort().join(', ')}.`);
  }
  const missing = allowed.filter(
    (key) => key !== '$comment' && !optional.includes(key) && !(key in row),
  );
  if (missing.length > 0) {
    fail(`${path} is missing key(s): ${missing.join(', ')}.`);
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${path} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function textArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  const items = value.map((item, index) => text(item, `${path}[${index}]`));
  const duplicates = items.filter((item, index) => items.indexOf(item) !== index);
  if (duplicates.length > 0) {
    fail(`${path} repeats: ${[...new Set(duplicates)].sort().join(', ')}.`);
  }
  return items;
}

function nonEmptyTextArray(value: unknown, path: string): string[] {
  const items = textArray(value, path);
  if (items.length === 0) fail(`${path} must not be empty.`);
  return items;
}

function optionalTextArray(value: unknown, path: string): string[] | null {
  return value === null ? null : nonEmptyTextArray(value, path);
}

function subsetOf(
  items: readonly string[],
  universe: readonly string[],
  path: string,
  universeName: string,
): void {
  const strays = items.filter((item) => !universe.includes(item));
  if (strays.length > 0) {
    fail(`${path} names column(s) absent from ${universeName}: ${strays.sort().join(', ')}.`);
  }
}

function parseSource(key: string, raw: unknown): SourceRegistration {
  const path = `sources.${key}`;
  const row = record(raw, path);
  expectKeys(row, SOURCE_KEYS, path);
  const registeredBy = enumValue(row.registered_by, REGISTRATION_KINDS, `${path}.registered_by`);
  const registeredIn = optionalText(row.registered_in, `${path}.registered_in`);
  if (registeredBy === 'unregistered' && registeredIn !== null) {
    fail(`${path} is unregistered but names a registration file.`);
  }
  if (registeredBy !== 'unregistered' && registeredIn === null) {
    fail(`${path} is registered by ${registeredBy} but names no registration file.`);
  }
  return {
    key,
    registeredBy,
    registeredIn,
    registrationOwner: optionalText(row.registration_owner, `${path}.registration_owner`),
    notes: textArray(row.notes, `${path}.notes`),
  };
}

function nonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${path} must be a non-negative integer.`);
  }
  return value;
}

function parseFinalsLabelRule(raw: unknown, path: string): FinalsLabelRule {
  const row = record(raw, path);
  expectKeys(row, FINALS_LABEL_RULE_KEYS, path);
  return {
    contains: text(row.contains, `${path}.contains`),
    roundType: enumValue(row.round_type, FINALS_LABEL_ROUND_TYPES, `${path}.round_type`),
  };
}

/**
 * AFLDB-ISSUE-228 §6.4 — one row of a per-season explicit round table. Every
 * row names exactly one `api_round_number`; `canonical_round_number` is
 * declared for a home-and-away row and forbidden everywhere else (a final
 * carries no round number, `matches_round_number_ck`); `finals_label_rules`
 * is declared for a `mixed_finals` row (and required non-empty there) and
 * forbidden everywhere else. Both fields are simply omitted, never `null`,
 * matching the optional-key convention `corroboration_policy` already uses.
 */
function parseDeclaredRoundRow(raw: unknown, path: string): DeclaredRoundRow {
  const row = record(raw, path);
  expectKeys(row, DECLARED_ROUND_ROW_KEYS, path, OPTIONAL_DECLARED_ROUND_ROW_KEYS);
  const apiRoundNumber = nonNegativeInt(row.api_round_number, `${path}.api_round_number`);
  const roundType = enumValue(row.round_type, DECLARED_ROUND_TYPES, `${path}.round_type`);

  const hasCanonicalNumber = 'canonical_round_number' in row;
  const hasLabelRules = 'finals_label_rules' in row;
  if (roundType === 'home_and_away') {
    if (!hasCanonicalNumber) fail(`${path} is 'home_and_away' but omits canonical_round_number.`);
    if (hasLabelRules) fail(`${path} is 'home_and_away' but declares finals_label_rules.`);
  } else if (roundType === 'mixed_finals') {
    if (hasCanonicalNumber) fail(`${path} is 'mixed_finals' but declares canonical_round_number.`);
    if (!hasLabelRules) fail(`${path} is 'mixed_finals' but omits finals_label_rules.`);
  } else {
    if (hasCanonicalNumber) fail(`${path} is '${roundType}' but declares canonical_round_number.`);
    if (hasLabelRules) fail(`${path} is '${roundType}' but declares finals_label_rules.`);
  }

  const canonicalRoundNumber = hasCanonicalNumber
    ? (() => {
      const n = nonNegativeInt(row.canonical_round_number, `${path}.canonical_round_number`);
      if (n < 1) fail(`${path}.canonical_round_number must be at least 1.`);
      return n;
    })()
    : null;

  const finalsLabelRules = hasLabelRules
    ? (() => {
      if (!Array.isArray(row.finals_label_rules) || row.finals_label_rules.length === 0) {
        fail(`${path}.finals_label_rules must be a non-empty array.`);
      }
      return row.finals_label_rules.map(
        (value, index) => parseFinalsLabelRule(value, `${path}.finals_label_rules[${index}]`),
      );
    })()
    : null;

  return {
    apiRoundNumber,
    apiAbbreviation: text(row.api_abbreviation, `${path}.api_abbreviation`),
    apiName: text(row.api_name, `${path}.api_name`),
    roundType,
    canonicalRoundNumber,
    finalsLabelRules,
  };
}

function parseDeclaredVocabulary(
  key: string, row: Record<string, unknown>, path: string,
): DeclaredRoundVocabulary {
  expectKeys(row, DECLARED_VOCABULARY_KEYS, path);
  const season = nonNegativeInt(row.season, `${path}.season`);
  if (season < 1897) fail(`${path}.season must be a real AFL/VFL season.`);
  if (!Array.isArray(row.rounds) || row.rounds.length === 0) {
    fail(`${path}.rounds must be a non-empty array.`);
  }
  const rounds = row.rounds.map((value, index) => parseDeclaredRoundRow(value, `${path}.rounds[${index}]`));

  const roundNumbers = rounds.map((r) => r.apiRoundNumber);
  const dupeRoundNumbers = roundNumbers.filter((n, i) => roundNumbers.indexOf(n) !== i);
  if (dupeRoundNumbers.length > 0) {
    fail(`${path}.rounds repeats api_round_number: ${[...new Set(dupeRoundNumbers)].sort().join(', ')}.`);
  }

  // §6.4: the canonical home-and-away numbers must be a contiguous 1..N run,
  // so the three writers (this module, createMatch(), admin-fixtures.ts) can
  // never be handed a gap or a duplicate to render.
  const canonicalHomeAndAway = rounds
    .filter((r) => r.roundType === 'home_and_away')
    .map((r) => r.canonicalRoundNumber!)
    .sort((a, b) => a - b);
  if (canonicalHomeAndAway.length === 0) {
    fail(`${path}.rounds declares no home_and_away round.`);
  }
  canonicalHomeAndAway.forEach((n, i) => {
    if (n !== i + 1) {
      fail(
        `${path}.rounds' canonical home-and-away numbers must be contiguous 1..`
        + `${canonicalHomeAndAway.length}, found ${canonicalHomeAndAway.join(', ')}.`,
      );
    }
  });

  return {
    key,
    shape: 'declared',
    description: text(row.description, `${path}.description`),
    mappingStatus: 'declared',
    season,
    evidence: nonEmptyTextArray(row.evidence, `${path}.evidence`),
    rounds,
  };
}

function parseAnchorVocabulary(
  key: string, row: Record<string, unknown>, path: string, mappingStatus: 'anchors_only' | 'complete',
): AnchorRoundVocabulary {
  expectKeys(row, VOCABULARY_KEYS, path);
  if (!Array.isArray(row.anchors)) fail(`${path}.anchors must be an array.`);
  const anchors = row.anchors.map((value, index) => {
    const anchorPath = `${path}.anchors[${index}]`;
    const anchor = record(value, anchorPath);
    expectKeys(anchor, ANCHOR_KEYS, anchorPath);
    const roundNumber = nonNegativeInt(anchor.round_number, `${anchorPath}.round_number`);
    return {
      roundNumber,
      meaning: text(anchor.meaning, `${anchorPath}.meaning`),
      evidence: text(anchor.evidence, `${anchorPath}.evidence`),
    };
  });
  return {
    key,
    shape: 'anchors',
    description: text(row.description, `${path}.description`),
    mappingStatus,
    mappingOwner: optionalText(row.mapping_owner, `${path}.mapping_owner`),
    anchors,
  };
}

function parseVocabulary(key: string, raw: unknown): RoundVocabulary {
  const path = `round_vocabularies.${key}`;
  const row = record(raw, path);
  const mappingStatus = enumValue(row.mapping_status, ROUND_MAPPING_STATUSES, `${path}.mapping_status`);
  if (mappingStatus === 'declared') return parseDeclaredVocabulary(key, row, path);
  return parseAnchorVocabulary(key, row, path, mappingStatus);
}

function parseFamily(raw: unknown, index: number): SourceFamilyContract {
  const path = `families[${index}]`;
  const row = record(raw, path);
  expectKeys(row, FAMILY_KEYS, path, OPTIONAL_FAMILY_KEYS);

  const sourceKey = text(row.source_key, `${path}.source_key`);
  const family = text(row.family, `${path}.family`);
  const label = `families[${sourceKey}/${family}]`;
  const status = enumValue(row.status, FAMILY_STATUSES, `${label}.status`);
  const knownColumns = optionalTextArray(row.known_columns, `${label}.known_columns`);
  const knownColumnsStatus = enumValue(
    row.known_columns_status, KNOWN_COLUMN_STATUSES, `${label}.known_columns_status`,
  );
  const requiredColumns = optionalTextArray(row.required_columns, `${label}.required_columns`);
  const externalKey = optionalTextArray(row.external_key, `${label}.external_key`);
  const hashExclusions = textArray(row.hash_exclusions, `${label}.hash_exclusions`);
  const zeroIsMissingColumns = textArray(
    row.zero_is_missing_columns, `${label}.zero_is_missing_columns`,
  );
  const sourceUpdatedAtField = optionalText(
    row.source_updated_at_field, `${label}.source_updated_at_field`,
  );

  // The two family grains are kept honest against each other: a `declared`
  // family must carry a full shape, and an `identity_only` one must carry none
  // of it. Anything in between would be a shape nobody proved.
  if (status === 'declared') {
    if (externalKey === null || requiredColumns === null || knownColumns === null) {
      fail(`${label} is 'declared' but omits external_key, required_columns or known_columns.`);
    }
    if (knownColumnsStatus === 'undeclared') {
      fail(`${label} is 'declared' but its known_columns_status is 'undeclared'.`);
    }
  } else {
    if (externalKey !== null || requiredColumns !== null || knownColumns !== null) {
      fail(`${label} is 'identity_only' but declares a key or column contract.`);
    }
    if (knownColumnsStatus !== 'undeclared') {
      fail(`${label} is 'identity_only' but its known_columns_status is not 'undeclared'.`);
    }
    if (hashExclusions.length > 0 || zeroIsMissingColumns.length > 0 || sourceUpdatedAtField !== null) {
      fail(`${label} is 'identity_only' but declares column-level semantics.`);
    }
  }

  if (knownColumns !== null) {
    subsetOf(requiredColumns ?? [], knownColumns, `${label}.required_columns`, 'known_columns');
    subsetOf(externalKey ?? [], knownColumns, `${label}.external_key`, 'known_columns');
    subsetOf(hashExclusions, knownColumns, `${label}.hash_exclusions`, 'known_columns');
    subsetOf(zeroIsMissingColumns, knownColumns, `${label}.zero_is_missing_columns`, 'known_columns');
    if (sourceUpdatedAtField !== null) {
      subsetOf([sourceUpdatedAtField], knownColumns, `${label}.source_updated_at_field`, 'known_columns');
    }
  }

  // A field excluded from the hash is volatile response noise; treating it as
  // an upstream mutation timestamp at the same time is a contradiction.
  if (sourceUpdatedAtField !== null && hashExclusions.includes(sourceUpdatedAtField)) {
    fail(`${label}.source_updated_at_field is also hash-excluded; it cannot be both.`);
  }

  const independencePath = `${label}.independence`;
  const independenceRow = record(row.independence, independencePath);
  expectKeys(independenceRow, INDEPENDENCE_KEYS, independencePath);
  const derivesFrom = optionalText(independenceRow.derives_from, `${independencePath}.derives_from`);
  const evidence = enumValue(
    independenceRow.evidence, INDEPENDENCE_EVIDENCE, `${independencePath}.evidence`,
  );
  if ((derivesFrom === null) !== (evidence === 'proven_independent')) {
    fail(
      `${independencePath} is inconsistent: derives_from ${derivesFrom === null ? 'is null' : 'is set'} `
      + `but evidence is '${evidence}'.`,
    );
  }
  if (derivesFrom === sourceKey) {
    fail(`${independencePath}.derives_from points at its own source.`);
  }

  return {
    sourceKey,
    family,
    endpoint: text(row.endpoint, `${label}.endpoint`),
    status,
    externalKey,
    requiredColumns,
    knownColumns,
    knownColumnsStatus,
    hashExclusions,
    sourceUpdatedAtField,
    zeroIsMissingColumns,
    roundVocabulary: optionalText(row.round_vocabulary, `${label}.round_vocabulary`),
    independence: {
      derivesFrom,
      group: text(independenceRow.group, `${independencePath}.group`),
      evidence,
    },
    promotionPolicy: enumValue(row.promotion_policy, PROMOTION_POLICIES, `${label}.promotion_policy`),
    promotionOwner: optionalText(row.promotion_owner, `${label}.promotion_owner`),
    // Undeclared reads as `blocking`: an omitted policy must never be the
    // permissive one. `null` is NOT the same as omitted and still fails.
    corroborationPolicy: row.corroboration_policy === undefined
      ? DEFAULT_CORROBORATION_POLICY
      : enumValue(
        row.corroboration_policy, CORROBORATION_POLICIES, `${label}.corroboration_policy`,
      ),
    evidence: nonEmptyTextArray(row.evidence, `${label}.evidence`),
    notes: textArray(row.notes, `${label}.notes`),
  };
}

/**
 * Validates the whole registry, fail-closed. Every returned contract has
 * already satisfied its cross-references, so callers never re-check them.
 */
export function parseSourceFamilyRegistry(raw: unknown): SourceFamilyRegistry {
  const root = record(raw, 'registry');
  expectKeys(root, ROOT_KEYS, 'registry', OPTIONAL_ROOT_KEYS);

  if (root.contract_version !== CONTRACT_VERSION) {
    fail(`registry.contract_version must be ${CONTRACT_VERSION}, found ${String(root.contract_version)}.`);
  }

  const sources = new Map<string, SourceRegistration>();
  for (const [key, value] of Object.entries(record(root.sources, 'sources'))) {
    sources.set(key, parseSource(key, value));
  }
  if (sources.size === 0) fail('registry.sources declares no source.');

  const roundVocabularies = new Map<string, RoundVocabulary>();
  for (const [key, value] of Object.entries(record(root.round_vocabularies, 'round_vocabularies'))) {
    roundVocabularies.set(key, parseVocabulary(key, value));
  }

  if (!Array.isArray(root.families)) fail('registry.families must be an array.');
  const families = root.families.map((value, index) => parseFamily(value, index));

  const seen = new Set<string>();
  for (const contract of families) {
    const label = `families[${contract.sourceKey}/${contract.family}]`;
    // `identity` is a machine key, deliberately NOT the human-readable `/`
    // form used by `label` above: its separator is U+0000, which no source
    // key or family can contain, so the key cannot be made ambiguous by a
    // value that happens to hold the separator. In-memory only — PostgreSQL
    // `text` cannot store U+0000, so persisting this key would need its own
    // decision (AFLDB-ISSUE-096 §16.11).
    const identity = `${contract.sourceKey}\u0000${contract.family}`;
    if (seen.has(identity)) fail(`${label} is declared more than once.`);
    seen.add(identity);

    if (!sources.has(contract.sourceKey)) {
      fail(`${label} names an undeclared source key.`);
    }
    if (contract.roundVocabulary !== null && !roundVocabularies.has(contract.roundVocabulary)) {
      fail(`${label}.round_vocabulary '${contract.roundVocabulary}' is not declared.`);
    }

    // Promotion is only ever declared for a family whose shape is proven and
    // whose source actually has a `sources` row to stamp provenance with.
    if (contract.promotionPolicy === 'reviewed') {
      if (contract.status !== 'declared') {
        fail(`${label} declares reviewed promotion without a declared column contract.`);
      }
      const registration = sources.get(contract.sourceKey)!;
      if (registration.registeredBy === 'unregistered') {
        fail(`${label} declares reviewed promotion but source '${contract.sourceKey}' has no sources row.`);
      }
    }
  }

  // A derived source may not invent a fresh independence group: it must join
  // the group of the source it derives from, or the two would be counted as
  // two witnesses for the same underlying information.
  for (const contract of families) {
    const { derivesFrom, group } = contract.independence;
    if (derivesFrom === null) continue;
    const label = `families[${contract.sourceKey}/${contract.family}]`;
    if (!sources.has(derivesFrom)) {
      fail(`${label}.independence.derives_from names an undeclared source key '${derivesFrom}'.`);
    }
    const upstream = families.filter((other) => other.sourceKey === derivesFrom);
    if (upstream.length === 0) {
      fail(`${label}.independence.derives_from names '${derivesFrom}', which declares no family.`);
    }
    if (!upstream.some((other) => other.independence.group === group)) {
      fail(
        `${label}.independence.group '${group}' is not a group declared by '${derivesFrom}'; `
        + 'a derived source must share its upstream group.',
      );
    }
  }

  // AFLDB-ISSUE-228 §7.5 (Q1). Optional, and empty (the pre-ISSUE-228 state)
  // when omitted. Each group names ≥ 2 distinct, declared source keys; a
  // source key may belong to at most one group, so "co-source" stays a
  // symmetric, unambiguous relation rather than a per-pair opt-in.
  const coSourceGroups: string[][] = [];
  if (root.co_source_groups !== undefined) {
    if (!Array.isArray(root.co_source_groups)) fail('registry.co_source_groups must be an array.');
    const seenInAnyGroup = new Set<string>();
    root.co_source_groups.forEach((value, index) => {
      const path = `registry.co_source_groups[${index}]`;
      const group = nonEmptyTextArray(value, path);
      if (group.length < 2) fail(`${path} must name at least two source keys.`);
      for (const key of group) {
        if (!sources.has(key)) fail(`${path} names an undeclared source key '${key}'.`);
        if (seenInAnyGroup.has(key)) fail(`${path} names '${key}', which already belongs to another group.`);
        seenInAnyGroup.add(key);
      }
      coSourceGroups.push([...group].sort());
    });
  }

  return {
    contractVersion: CONTRACT_VERSION, sources, roundVocabularies, families, coSourceGroups,
  };
}

/** True when `a` and `b` are declared co-sources for at least one target
 * (AFLDB-ISSUE-228 §7.5, Q1). A source is always its own co-source. */
export function areCoSources(registry: SourceFamilyRegistry, a: string, b: string): boolean {
  if (a === b) return true;
  return registry.coSourceGroups.some((group) => group.includes(a) && group.includes(b));
}

export function findSourceFamily(
  registry: SourceFamilyRegistry, sourceKey: string, family: string,
): SourceFamilyContract | undefined {
  return registry.families.find((c) => c.sourceKey === sourceKey && c.family === family);
}

/** Undeclared is a refusal: an unregistered family has no contract to obey. */
export function getSourceFamily(
  registry: SourceFamilyRegistry, sourceKey: string, family: string,
): SourceFamilyContract {
  const contract = findSourceFamily(registry, sourceKey, family);
  if (!contract) fail(`No contract is declared for source '${sourceKey}' family '${family}'.`);
  return contract;
}

/**
 * The independence groups covering these sources for one family, deduplicated.
 * Corroboration counts THESE, never the number of source rows. Sources share
 * one witness only where this per-family registry assigns the same group.
 */
export function independenceGroups(
  registry: SourceFamilyRegistry, family: string, sourceKeys: readonly string[],
): string[] {
  const groups = sourceKeys.map((key) => getSourceFamily(registry, key, family).independence.group);
  return [...new Set(groups)].sort();
}

export function countIndependentWitnesses(
  registry: SourceFamilyRegistry, family: string, sourceKeys: readonly string[],
): number {
  return independenceGroups(registry, family, sourceKeys).length;
}

export function isPromotable(contract: SourceFamilyContract): boolean {
  return contract.promotionPolicy === 'reviewed';
}

/**
 * The typed-projection gate. A missing required column or an unexpected column
 * is a refusal, never a silent NULL — P3 proved a source's column set can
 * change between two rounds of the same season.
 *
 * `requireColumns` (default `true`) exists for AFLDB-ISSUE-228 S7's Brownlow
 * families, whose one "observation" is a wrapper around a COLLECTION
 * (`matchVotes[]` / `leaderboard[]`) rather than a single always-present
 * record: `flattenObservedColumns()` contributes NO path at all for an empty
 * array (its own documented rule), so a required column declared as
 * `matchVotes.matchId` etc. can never be observed when the provider
 * legitimately publishes zero records yet — a valid pre-count state, not a
 * malformed source. The caller passes `false` only when it has already
 * established the collection the required columns live under is empty; the
 * unexpected-column check still runs unconditionally either way, so a
 * genuinely new/renamed top-level field is still caught even on an empty
 * publication. Every other family (`match`, `match_roster`,
 * `player_match_stats`, and AFL Tables' own families) calls this with the
 * default and is unaffected.
 */
export function assertProjectableColumns(
  contract: SourceFamilyContract, observedColumns: readonly string[],
  options: { requireColumns?: boolean } = {},
): void {
  const label = `${contract.sourceKey}/${contract.family}`;
  if (contract.requiredColumns === null || contract.knownColumns === null) {
    fail(`${label} declares no column contract, so nothing may be projected from it.`);
  }
  if (options.requireColumns ?? true) {
    const observed = new Set(observedColumns);
    const missing = contract.requiredColumns.filter((column) => !observed.has(column));
    if (missing.length > 0) {
      fail(`${label} is missing required column(s): ${missing.join(', ')}.`);
    }
  }
  const unexpected = observedColumns.filter((column) => !contract.knownColumns!.includes(column));
  if (unexpected.length > 0) {
    fail(
      `${label} returned undeclared column(s): ${[...new Set(unexpected)].sort().join(', ')}. `
      + 'Declare them in data/reference/source-families.json before projecting this payload.',
    );
  }
}

export function roundKey(
  contract: SourceFamilyContract, roundNumber: number | null, roundLabel: string | null,
): RoundKey {
  if (contract.roundVocabulary === null) {
    fail(`${contract.sourceKey}/${contract.family} declares no round vocabulary.`);
  }
  return { vocabulary: contract.roundVocabulary, roundNumber, roundLabel };
}

/**
 * Round integers are only comparable inside one vocabulary. AFL Tables numbers
 * the 2026 Opening Round 1, Squiggle numbers it 0, and the AFL API's round 25
 * is Wildcard Finals while AFL Tables' round 25 is the last home-and-away
 * round — three vocabularies colliding on the same integers.
 */
export function roundKeysEqual(a: RoundKey, b: RoundKey): boolean {
  if (a.vocabulary !== b.vocabulary) {
    fail(
      `Round keys from different vocabularies ('${a.vocabulary}' and '${b.vocabulary}') `
      + 'cannot be compared; a declared per-source mapping is required.',
    );
  }
  return a.roundNumber === b.roundNumber && a.roundLabel === b.roundLabel;
}

/**
 * Cross-vocabulary translation stays refused while every declared mapping is
 * `anchors_only`. The anchors are proven points, not a mapping.
 */
export function translateRound(
  registry: SourceFamilyRegistry, key: RoundKey, targetVocabulary: string,
): RoundKey {
  if (key.vocabulary === targetVocabulary) return key;
  for (const vocabulary of [key.vocabulary, targetVocabulary]) {
    const declared = registry.roundVocabularies.get(vocabulary);
    if (!declared) fail(`Round vocabulary '${vocabulary}' is not declared.`);
    if (declared.mappingStatus !== 'complete') {
      const owner = declared.shape === 'anchors' ? (declared.mappingOwner ?? 'unassigned') : 'AFLDB-ISSUE-228';
      fail(
        `Round vocabulary '${vocabulary}' is '${declared.mappingStatus}', so no round may be `
        + `translated to or from it (owner: ${owner}).`,
      );
    }
  }
  fail(`No round mapping is declared from '${key.vocabulary}' to '${targetVocabulary}'.`);
}
