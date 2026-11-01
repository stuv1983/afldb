/**
 * AFLDB V2 — the GOVERNED 2025 fixture-identity observation prerequisite of the ordered Brownlow workflow
 * (stage B0, run through tools/v2/brownlow-production-correction.ts as operation `observe`, stage
 * `fixture-identities-2025`). F-BRO-1 (2026-11-01): production holds no 2025 `afl_api` match-family
 * observations, adopt cannot map the 207 vote sets to matches without them, and the general settle CLI
 * (`settle-afl-api-fixtures.ts`) refuses the sealed season 2025 — correctly, and that refusal is NOT changed.
 *
 * What this module is, and is not:
 *  - It is NOT a bypass of the seal. It is one fixed, pinned input: the retained, authentic 2025 fixtures
 *    snapshot `afl-api-2025-2026-10-20-014218`, identified by the sha256 of its manifest (which in turn
 *    lists the sha256 of every file). Any other label, any manifest byte that differs, any file that no
 *    longer matches the manifest, any change in what the snapshot builds (212 records; the four finals
 *    matches `FW1` that need a finals label stay refused), is rejected BEFORE any connection.
 *  - Its entire write surface is `persistAflApiFixtureObservations()` (spine observations: staging source
 *    records, versions, payloads) plus the one `import_batches` row that owns them. It runs inside the
 *    runner's approved transaction, which also proves — by per-table hashes before and after — that no
 *    canonical football table moved.
 *  - It never contacts the provider and manufactures nothing: the records are built from the retained
 *    provider responses by the same `emitAflApiMatch()` the settle tool uses.
 *
 * Changing a pin is a code change that goes through review; it is never a flag or an input file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type postgres from 'postgres';

import { FIXTURE_IDENTITIES_STAGE, correctionHash } from '@/db/queries/brownlow-production-correction';
import { parseAflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import {
  buildAflApiFixtureRecords,
  persistAflApiFixtureObservations,
  type AflApiFixtureObservationCounters,
  type AflApiFixtureRecord,
} from '@/lib/acquisition/afl-api-fixture-identity';
import { resolveAflApiSourceId } from '@/lib/acquisition/afl-api-match-identity';
import { finalizeSettleImportBatch } from '@/lib/acquisition/settle-core';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '@/lib/acquisition/source-families';
import { asImportBatchId } from '@/lib/import-batch-id';

import { fixturesRawFrom, verifyManifest } from '../current-season/settle-afl-api-fixtures';

export const FIXTURE_PREREQUISITE_STAGE = FIXTURE_IDENTITIES_STAGE;

/** The one snapshot this stage may observe. Reviewed constants, never inputs. */
export const FIXTURE_PREREQUISITE_PIN = Object.freeze({
  season: 2025,
  label: 'afl-api-2025-2026-10-20-014218',
  /** sha256 of the retained manifest.json bytes; the manifest lists every file's sha256. */
  manifestSha256: '46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36',
  scopeKey: 'season=2025',
  /** 216 fixtures in the feed; 212 build. The four below carry no finals label and stay refused. */
  builtRecords: 212,
  refusedProviderMatchIds: Object.freeze(['CD_M20250142501', 'CD_M20250142502', 'CD_M20250142503', 'CD_M20250142504']),
});

export interface FixturePrerequisiteObservation {
  stage: typeof FIXTURE_PREREQUISITE_STAGE;
  label: string;
  season: number;
  manifestSha256: string;
  builtRecords: number;
  refusedProviderMatchIds: string[];
  /** correctionHash over [providerMatchId, correctionHash(payload)] in providerMatchId order. */
  recordsDigest: string;
}

export interface LoadedFixturePrerequisite {
  observation: FixturePrerequisiteObservation;
  records: readonly AflApiFixtureRecord[];
  registry: SourceFamilyRegistry;
}

const refuse = (reason: string): never => { throw new Error(`Fixture prerequisite refused: ${reason}`); };

/** Offline and fail-closed: no connection, no provider contact. */
export function loadFixturePrerequisite(projectRoot: string, label: string): LoadedFixturePrerequisite {
  const pin = FIXTURE_PREREQUISITE_PIN;
  if (label !== pin.label) refuse(`only the pinned snapshot '${pin.label}' may be observed by this stage`);
  const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'fixtures', label);
  const manifestSha256 = createHash('sha256').update(readFileSync(join(snapshotDir, 'manifest.json'))).digest('hex');
  if (manifestSha256 !== pin.manifestSha256) refuse('manifest.json differs from the pinned bytes');
  const { manifest, files } = verifyManifest(snapshotDir);
  if (manifest.season !== pin.season) refuse(`manifest season is not ${pin.season}`);
  const registry = parseSourceFamilyRegistry(JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'source-families.json'), 'utf8')));
  const identities = parseAflApiIdentities(JSON.parse(readFileSync(join(projectRoot, 'data', 'reference', 'afl-api-identities.json'), 'utf8')));
  const { records, buildFailures } = buildAflApiFixtureRecords(fixturesRawFrom(snapshotDir, files), registry, identities);
  const refused = buildFailures.map((f) => f.providerMatchId ?? '(unknown)').sort();
  if (records.length !== pin.builtRecords || correctionHash(refused) !== correctionHash([...pin.refusedProviderMatchIds])) {
    refuse(`the snapshot builds ${records.length} records with refusals [${refused.join(', ')}]; the pinned contract is ${pin.builtRecords} and [${pin.refusedProviderMatchIds.join(', ')}]`);
  }
  const ordered = [...records].sort((a, b) => a.providerMatchId.localeCompare(b.providerMatchId));
  if (new Set(ordered.map((r) => r.providerMatchId)).size !== ordered.length) refuse('duplicate provider match ids');
  if (ordered.some((r) => r.projection.season !== pin.season)) refuse('a built record is not for season 2025');
  const observation: FixturePrerequisiteObservation = {
    stage: FIXTURE_PREREQUISITE_STAGE, label, season: pin.season, manifestSha256, builtRecords: ordered.length,
    refusedProviderMatchIds: refused,
    recordsDigest: correctionHash(ordered.map((r) => [r.providerMatchId, correctionHash(r.payload)])),
  };
  return { observation, records: ordered, registry };
}

export interface FixturePrerequisiteResult {
  stage: typeof FIXTURE_PREREQUISITE_STAGE;
  batchId: string;
  observationsSeen: number;
  versionsAppended: number;
  observationsUnchanged: number;
}

/** Runs INSIDE the runner's approved transaction; any thrown error rolls the whole stage back. */
export async function applyFixturePrerequisite(
  tx: postgres.TransactionSql, loaded: LoadedFixturePrerequisite, notesRevision: string,
): Promise<FixturePrerequisiteResult> {
  const pin = FIXTURE_PREREQUISITE_PIN;
  const sourceId = await resolveAflApiSourceId(tx);
  const [batch] = await tx<{ id: string }[]>`
    INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
    VALUES (${sourceId}, 'brownlow-production-correction.ts', 'staging.source_record_versions', ${loaded.records.length},
      ${`Governed Brownlow prerequisite (stage ${FIXTURE_PREREQUISITE_STAGE}); retained authentic fixtures-only snapshot=${loaded.observation.label}; `
        + `manifest sha256=${loaded.observation.manifestSha256}; season=${pin.season}; revision=${notesRevision}`})
    RETURNING id`;
  const batchId = asImportBatchId(batch.id);
  const counters: AflApiFixtureObservationCounters = await persistAflApiFixtureObservations(tx, {
    sourceId, season: pin.season, registry: loaded.registry, records: loaded.records, batchId, observedAt: new Date().toISOString(),
  });
  await finalizeSettleImportBatch(tx, batchId, counters);
  if (counters.observationsSeen !== pin.builtRecords || counters.versionsAppended !== pin.builtRecords || counters.observationsUnchanged !== 0) {
    refuse(`observation counters ${JSON.stringify(counters)} differ from the pinned ${pin.builtRecords} first-time versions; rollback`);
  }
  return { stage: FIXTURE_PREREQUISITE_STAGE, batchId: batch.id, ...counters };
}
