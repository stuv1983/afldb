/**
 * AFLDB V2 Stage 3 — offline replay of a retained AFL API snapshot (docs/v2/plan.md §3 D1).
 *
 * Replaying re-verifies the snapshot manifest (every listed file re-hashed; a changed byte
 * refuses), re-reads the hash-bound units, assesses the retained season feed and rebuilds the
 * validated settle bundle — EXACTLY as the production loader `loadAflApiSettleBundle`
 * (tools/current-season/settle-afl-api.ts) does, minus the database. It returns the bundle, the
 * manifest sha256 that names the snapshot, and a `planDigest`: the sha256 of the canonical JSON of
 * everything the bundle PROPOSES (units' settle records, build failures, the season-feed
 * assessment, the season and the bundle contract version). The digest excludes the snapshot LABEL
 * and the directory path, so a byte-identical copy of a snapshot, moved or renamed, replays to the
 * same digest: same snapshot bytes + same registry + same identities => same proposals.
 *
 * The bundle builder is INJECTED (`buildBundle`). `buildAflApiSettleBundle` lives in
 * src/lib/acquisition/settle-afl-api.ts, a writer module whose runtime closure reaches
 * src/db/queries/player-derived.ts and the postgres library; this package index must not pull
 * that in, so the type of the builder is borrowed with `import type` and the caller passes the
 * real function (tests/v2-acquisition-replay.test.ts does).
 *
 * Nothing here opens a database connection, makes a network request or writes a file.
 * What is NOT proved here: that a promotion transaction rolls back completely on PostgreSQL. No
 * database is used by this module or its tests (recorded as a V2-GAP by the orchestrator).
 */
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { assessAflApiSeasonEnumeration } from '@/lib/acquisition/afl-api-season-enumeration';
import {
  aflApiSeasonFeedTextFrom,
  aflApiSnapshotManifestSha256,
  aflApiUnitSourcesFrom,
  verifyAflApiSnapshotManifest,
} from '@/lib/acquisition/afl-api-snapshot';
import type { AflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import { canonicalJson, type JsonValue } from '@/lib/acquisition/observations';
import type { buildAflApiSettleBundle, AflApiSettleBundle } from '@/lib/acquisition/settle-afl-api';
import type { SourceFamilyRegistry } from '@/lib/acquisition/source-families';

/** The shape of `buildAflApiSettleBundle` (settle-afl-api.ts), injected by the caller. */
export type AflApiBundleBuilder = typeof buildAflApiSettleBundle;

export interface AflApiReplayInput {
  /** The snapshot directory: data/sources/afl_api/matches/<label>/. */
  snapshotDir: string;
  registry: SourceFamilyRegistry;
  identities: AflApiIdentities;
  /** Pass the real `buildAflApiSettleBundle`; see the module header for why it is injected. */
  buildBundle: AflApiBundleBuilder;
  /** Defaults to the directory name, as the production loader's `--label` is. Not part of `planDigest`. */
  snapshotLabel?: string;
}

export interface AflApiReplayResult {
  bundle: AflApiSettleBundle;
  /** sha256 of manifest.json: the snapshot's identity. */
  manifestSha256: string;
  /** sha256 over the canonical JSON of what the bundle proposes (see `aflApiPlanDigest`). */
  planDigest: string;
}

/**
 * The digest of what a bundle proposes. Units contribute their settle records (the evidence and
 * projections a settle would resolve and reconcile); the label is deliberately not included.
 */
export function aflApiPlanDigest(
  bundle: Pick<AflApiSettleBundle, 'season' | 'bundleContractVersion' | 'units' | 'buildFailures' | 'seasonFeed'>,
): string {
  const proposal = {
    season: bundle.season,
    bundleContractVersion: bundle.bundleContractVersion,
    units: bundle.units.map((unit) => unit.settleRecords),
    buildFailures: bundle.buildFailures,
    seasonFeed: bundle.seasonFeed,
  };
  return createHash('sha256').update(canonicalJson(proposal as unknown as JsonValue)).digest('hex');
}

/** Replay a retained snapshot offline. Throws on a missing manifest, a hash mismatch or a manifest with no numeric season. */
export function replayAflApiSnapshot(input: AflApiReplayInput): AflApiReplayResult {
  const { snapshotDir } = input;
  const { manifest, files } = verifyAflApiSnapshotManifest(snapshotDir);
  const season = manifest.season;
  if (typeof season !== 'number') throw new Error('manifest.json carries no numeric season.');

  const sources = aflApiUnitSourcesFrom(snapshotDir, files);
  const seasonFeedText = aflApiSeasonFeedTextFrom(snapshotDir, files);
  const seasonIdentity = input.identities.seasons.get(season);
  const seasonFeed = seasonFeedText === null || seasonIdentity === undefined
    ? undefined
    : assessAflApiSeasonEnumeration(seasonFeedText, {
      season, compSeasonProviderId: seasonIdentity.providerId,
    });
  const bundle = input.buildBundle({
    season,
    snapshotLabel: input.snapshotLabel ?? basename(snapshotDir),
    sources,
    registry: input.registry,
    identities: input.identities,
    seasonFeed,
  });
  return {
    bundle,
    manifestSha256: aflApiSnapshotManifestSha256(snapshotDir),
    planDigest: aflApiPlanDigest(bundle),
  };
}
