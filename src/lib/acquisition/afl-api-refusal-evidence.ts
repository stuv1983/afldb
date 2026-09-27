/**
 * AFLDB-ISSUE-252 D-252-12 — the AFL API settle's canonical refusal census.
 *
 * `canonicalApplyRefusals` is a count: after a run it cannot say which target was refused or
 * why. The settle now also returns one evidence entry per increment of that counter, collected at
 * the same two sites (`applyUnitOutcome()` and the I244-F010 identity withholding in
 * `settle-afl-api.ts`), so `evidence.length === canonicalApplyRefusals` is checkable.
 *
 * Pure: no connection, no file I/O. The canonical form and digest here are the ONE serialisation
 * the preparation record, the source proof and the dry-run/apply parity check all compare, so a
 * census is identified by stable source identity only — never by a canonical row id.
 */
import { createHash } from 'node:crypto';

import type { CanonicalApplyRefusal, CanonicalTargetTable } from './canonical-apply';
import type { MATCH_IDENTITY_REFUSAL } from './settle-core';

export type AflApiCanonicalRefusalReason = CanonicalApplyRefusal | typeof MATCH_IDENTITY_REFUSAL;

/** One refused target, as the settle observed it. */
export type AflApiCanonicalRefusalEvidence = {
  family: string;
  externalRecordId: string;
  targetTable: CanonicalTargetTable;
  refusal: AflApiCanonicalRefusalReason;
  /** The canonical `match_key` the unit wrote against (stable identity, not a row id). */
  matchKey: string;
  renderedFields: readonly string[];
  /**
   * `foreign_source_owner` / `ownership_indeterminate`: the owner the canonical applier read
   * inside its savepoint (`CanonicalApplyTargetResult.ownerSourceKey`). `null` everywhere else,
   * and wherever that owner was absent or unreadable.
   */
  ownerSourceKey: string | null;
};

/** The canonical, serialised form: fixed key order, rendered fields sorted. */
export type AflApiRefusalCensusEntry = {
  family: string;
  external_record_id: string;
  target_table: string;
  refusal: string;
  match_key: string;
  rendered_fields: string[];
  owner_source_key: string | null;
};

export function aflApiRefusalCensusEntry(evidence: AflApiCanonicalRefusalEvidence): AflApiRefusalCensusEntry {
  return {
    family: evidence.family,
    external_record_id: evidence.externalRecordId,
    target_table: evidence.targetTable,
    refusal: evidence.refusal,
    match_key: evidence.matchKey,
    rendered_fields: [...evidence.renderedFields].sort(),
    owner_source_key: evidence.ownerSourceKey,
  };
}

/** Re-emit an entry with the canonical key order, whatever order it was parsed in. */
function canonicalEntry(entry: AflApiRefusalCensusEntry): AflApiRefusalCensusEntry {
  return {
    family: entry.family,
    external_record_id: entry.external_record_id,
    target_table: entry.target_table,
    refusal: entry.refusal,
    match_key: entry.match_key,
    rendered_fields: [...entry.rendered_fields],
    owner_source_key: entry.owner_source_key,
  };
}

/** Total, locale-free order: the serialised entry compared by code unit. */
export function compareAflApiRefusalCensusEntries(a: AflApiRefusalCensusEntry, b: AflApiRefusalCensusEntry): number {
  const x = JSON.stringify(canonicalEntry(a));
  const y = JSON.stringify(canonicalEntry(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The deterministic census of a run's refusal evidence. */
export function canonicalAflApiRefusalCensus(
  evidence: readonly AflApiCanonicalRefusalEvidence[],
): AflApiRefusalCensusEntry[] {
  return evidence.map(aflApiRefusalCensusEntry).sort(compareAflApiRefusalCensusEntries);
}

/** Evidence in the census order, for the settle result. */
export function sortAflApiRefusalEvidence(
  evidence: readonly AflApiCanonicalRefusalEvidence[],
): AflApiCanonicalRefusalEvidence[] {
  return [...evidence].sort((a, b) => compareAflApiRefusalCensusEntries(aflApiRefusalCensusEntry(a), aflApiRefusalCensusEntry(b)));
}

/** sha256 over the census exactly as ordered (callers canonicalise first; a parser checks order). */
export function aflApiRefusalCensusSha256(entries: readonly AflApiRefusalCensusEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries.map(canonicalEntry))).digest('hex');
}
