import { assessAflApiSeasonEnumeration } from '../../src/lib/acquisition/afl-api-season-enumeration';

describe('rem350 N: the OFF-SEASON nightly (a complete season feed that lists no concluded match) after the opening', () => {
  it('N', async () => {
    expect(setupOk).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM seasons WHERE year = ${FIXTURE_SEASON}`;
    const feed = assessAflApiSeasonEnumeration(JSON.stringify({ matches: [], meta: { pagination: { numEntries: 0 } } }),
      { season: FIXTURE_SEASON, compSeasonProviderId: 'CD_S2027014' });
    const bundle = { snapshotLabel: `${SNAPSHOT_LABEL}-N`, season: FIXTURE_SEASON, bundleContractVersion: 2 as const, units: [], buildFailures: [], seasonFeed: feed };
    const [{ b0 }] = await sql<{ b0: number }[]>`SELECT count(*)::int AS b0 FROM import_batches`;
    const r = await runSettleAflApi(sql, { bundle, registry, apply: true, autoApply: true, requireCompleteSource: true, inProgressSeasons: [FIXTURE_SEASON] });
    const [{ b1 }] = await sql<{ b1: number }[]>`SELECT count(*)::int AS b1 FROM import_batches`;
    console.log(`[rem350] N: ${JSON.stringify({ seasonRow: n, feedComplete: feed.complete, gaps: feed.gaps.length, applied: r.applied, rollbackReason: r.rollbackReason,
      halt: r.halt, completeness: r.sourceCompleteness?.status ?? null, batchesBefore: b0, batchesAfter: b1 })}`);
  }, 600_000);
});
