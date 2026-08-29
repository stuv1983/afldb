/**
 * AFLDB-ISSUE-099 T6 — the migration-074 observation persistence layer.
 *
 * Extracted, behaviour-preserving, from
 * `src/lib/external-afl/current-season-import.ts:706-857`, where it was the
 * de facto spine writer inline in one importer. The SQL, the lock, the
 * decision call, the write order and the absence predicate are unchanged;
 * only the couplings to that one importer's row shape — family, external
 * record id, scope key and payload — are now parameters, so a second family
 * importer reaches the spine through this contract rather than reimplementing
 * it. `AFLDB-ISSUE-093` §H11 is the reason: a second implementation of one
 * contract is exactly how an acquirer and its validator drift apart.
 *
 * The division of labour is `observations.ts`'s: `decideObservation()`
 * decides, this module applies. Nothing here re-decides, and nothing here
 * touches a canonical table.
 *
 * **Never deletes.** Absence is state — `staging.source_records.absent_since`
 * — never a row deletion, and never a bulk table wipe. That holds for the
 * spine here and for every ISSUE-099 typed projection (obligation O1), and is
 * pinned as a source assertion by `tests/current-season-import.test.ts`, which
 * greps this file for both keywords. Do not name either one in prose here.
 */
import postgres from 'postgres';

import type { ImportBatchId } from '../import-batch-id';

import {
  decideObservation,
  type JsonValue,
  type ObservationHead,
} from './observations';
import type { SourceFamilyContract } from './source-families';

/** One external record as observed in this run. */
export type SourceObservation = {
  /** The family contract; `contract.family` is the stored family key. */
  contract: SourceFamilyContract;
  /** The database-local `sources.id`, resolved at the persistence boundary. */
  sourceId: number;
  externalRecordId: string;
  /** The enumeration scope this record belongs to, e.g. `season=2026`. */
  scopeKey: string;
  payload: JsonValue;
};

export type PersistObservationResult = 'version_inserted' | 'head_refreshed';

/**
 * Persist one observation: read the open head under `FOR UPDATE OF r`, ask
 * `decideObservation()` what moved, then either refresh the record head alone
 * (unchanged content: zero payloads, zero versions) or store the payload,
 * close the previous version, append `version_seq + 1` and move the head.
 *
 * Called for **every enumerated record**, including one whose downstream
 * projection is rejected — the record head's `last_seen_at` must advance or
 * the next absence sweep would falsely mark a record it actually saw
 * (ISSUE-099 §19).
 */
export async function persistSourceObservation(
  tx: postgres.TransactionSql,
  observation: SourceObservation,
  batchId: ImportBatchId,
  observedAt: string,
): Promise<PersistObservationResult> {
  const { contract, sourceId, externalRecordId, scopeKey, payload } = observation;
  const family = contract.family;
  const [storedHead] = await tx<{
    versionSeq: number;
    payloadHash: string;
    hashRecipe: string;
    rawPayload: JsonValue;
    absentSince: Date | string | null;
  }[]>`
    SELECT v.version_seq AS "versionSeq",
           v.payload_hash AS "payloadHash",
           p.hash_recipe AS "hashRecipe",
           p.raw_payload AS "rawPayload",
           r.absent_since AS "absentSince"
      FROM staging.source_records r
      JOIN staging.source_record_versions v
        ON v.source_id = r.source_id
       AND v.family = r.family
       AND v.external_record_id = r.external_record_id
       AND v.version_seq = r.current_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id
       AND p.family = v.family
       AND p.payload_hash = v.payload_hash
     WHERE r.source_id = ${sourceId}
       AND r.family = ${family}
       AND r.external_record_id = ${externalRecordId}
     FOR UPDATE OF r
  `;
  const head: ObservationHead | null = storedHead ? {
    versionSeq: storedHead.versionSeq,
    payloadHash: storedHead.payloadHash,
    hashRecipe: storedHead.hashRecipe,
    rawPayload: storedHead.rawPayload,
    absentSince: storedHead.absentSince === null ? null : String(storedHead.absentSince),
  } : null;
  const decision = decideObservation({ contract, head, payload, observedAt });

  if (decision.action === 'unchanged') {
    await tx`
      UPDATE staging.source_records
         SET scope_key = ${scopeKey},
             last_seen_at = ${observedAt},
             last_batch_id = ${batchId},
             absent_since = NULL
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND external_record_id = ${externalRecordId}
    `;
    return 'head_refreshed';
  }

  await tx`
    INSERT INTO staging.source_payloads (
      source_id, family, payload_hash, hash_recipe, raw_payload, first_stored_at
    ) VALUES (
      ${sourceId}, ${family}, ${decision.payloadHash}, ${decision.recipe},
      ${tx.json(payload as never)}, ${observedAt}
    )
    ON CONFLICT (source_id, family, payload_hash) DO NOTHING
  `;

  if (decision.closesPreviousVersion) {
    await tx`
      UPDATE staging.source_record_versions
         SET observed_to = ${observedAt}, closed_by_batch_id = ${batchId}
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND external_record_id = ${externalRecordId}
         AND version_seq = ${decision.versionSeq - 1}
         AND observed_to IS NULL
    `;
  }

  await tx`
    INSERT INTO staging.source_record_versions (
      source_id, family, external_record_id, version_seq, payload_hash,
      source_updated_at, observed_from, opened_by_batch_id
    ) VALUES (
      ${sourceId}, ${family}, ${externalRecordId}, ${decision.versionSeq},
      ${decision.payloadHash}, ${decision.sourceUpdatedAt}, ${observedAt}, ${batchId}
    )
  `;

  if (head === null) {
    await tx`
      INSERT INTO staging.source_records (
        source_id, family, external_record_id, scope_key,
        current_version_seq, current_payload_hash,
        first_seen_at, last_seen_at, last_batch_id, absent_since
      ) VALUES (
        ${sourceId}, ${family}, ${externalRecordId}, ${scopeKey},
        ${decision.versionSeq}, ${decision.payloadHash},
        ${observedAt}, ${observedAt}, ${batchId}, NULL
      )
    `;
  } else {
    await tx`
      UPDATE staging.source_records
         SET scope_key = ${scopeKey},
             current_version_seq = ${decision.versionSeq},
             current_payload_hash = ${decision.payloadHash},
             last_seen_at = ${observedAt},
             last_batch_id = ${batchId},
             absent_since = NULL
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND external_record_id = ${externalRecordId}
    `;
  }
  return 'version_inserted';
}

/**
 * One `(source_id, family, scope_key)` the run actually enumerated.
 *
 * A scope appears here only when its enumeration is proven complete. A caller
 * that cannot represent every record it saw — ISSUE-099's unkeyed rejections,
 * §19 — simply omits the scope, and this pass then asserts nothing about it.
 */
export type EnumeratedScope = {
  sourceId: number;
  family: string;
  scopeKey: string;
};

/**
 * Stamp `absent_since` on records inside an enumerated scope that this batch
 * did not touch. Scoped by `(source_id, family, scope_key)`, so it can never
 * reach another source's rows, and bounded to rows not already absent so a
 * repeat run does not restamp.
 *
 * Absence is asserted, never deleted: no row is removed here, no version is
 * appended, and no canonical table is touched.
 */
export async function markMissingObservationsAbsent(
  tx: postgres.TransactionSql,
  scopes: readonly EnumeratedScope[],
  batchId: ImportBatchId,
  observedAt: string,
): Promise<number> {
  const distinct = new Map<string, EnumeratedScope>();
  for (const scope of scopes) {
    distinct.set(`${scope.sourceId}|${scope.family}|${scope.scopeKey}`, scope);
  }

  let markedAbsent = 0;
  for (const { sourceId, family, scopeKey } of distinct.values()) {
    const rows = await tx`
      UPDATE staging.source_records
         SET absent_since = ${observedAt}
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND scope_key = ${scopeKey}
         AND last_batch_id <> ${batchId}
         AND absent_since IS NULL
       RETURNING external_record_id
    `;
    markedAbsent += rows.length;
  }
  return markedAbsent;
}
