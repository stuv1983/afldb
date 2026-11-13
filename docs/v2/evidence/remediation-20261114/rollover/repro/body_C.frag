describe('rem350 C: the same nightly-shaped settle for season 2027 after the opening was applied', () => {
  it('C', async () => {
    expect(setupOk).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM seasons WHERE year = ${FIXTURE_SEASON}`;
    const bundle = buildAflApiSettleBundle({
      season: FIXTURE_SEASON, snapshotLabel: SNAPSHOT_LABEL, sources: [unitSource()], registry, identities,
    });
    let outcome: Record<string, unknown>;
    try {
      const r = await runSettleAflApi(sql, {
        bundle: { ...bundle, snapshotLabel: `${SNAPSHOT_LABEL}-C` }, registry, apply: true, autoApply: true,
        requireCompleteSource: true, inProgressSeasons: [FIXTURE_SEASON],
      });
      outcome = { applied: r.applied, rollbackReason: r.rollbackReason, halt: r.halt, canonicalApplyFailures: r.counters.canonicalApplyFailures,
        canonicalRowsInserted: r.counters.canonicalRowsInserted, completeness: r.sourceCompleteness?.status ?? null };
    } catch (error) {
      const e = error as { message?: string; code?: string; constraint_name?: string; table_name?: string; schema_name?: string };
      outcome = { threw: true, code: e.code, constraint: e.constraint_name, schema: e.schema_name, table: e.table_name };
    }
    const [{ m }] = await sql<{ m: number }[]>`SELECT count(*)::int AS m FROM matches WHERE season = ${FIXTURE_SEASON}`;
    console.log(`[rem350] C: ${JSON.stringify({ seasonRowBefore: n, units: bundle.units.length, buildFailures: bundle.buildFailures.length, ...outcome, matchesAfter: m })}`);
  }, 600_000);
});
