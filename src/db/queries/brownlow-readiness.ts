/** Existing availability/publication decisions, independent of football completion.
 * Column expressions are internal SQL only; never accept request text here.
 * Kept in parity with tools/migration/brownlow_readiness.py.
 */
export function brownlowAcceptedSql(season: string): string {
  return `(
    NOT EXISTS (SELECT 1 FROM stat_availability av
      WHERE av.stat_key = 'brownlow_season_total' AND av.season = ${season}
        AND av.coverage = 'not_applicable')
    AND (EXISTS (SELECT 1 FROM stat_availability av
      WHERE av.stat_key = 'brownlow_season_total' AND av.season = ${season}
        AND av.coverage = 'complete')
      OR EXISTS (SELECT 1 FROM brownlow_season_authority ba
        WHERE ba.season = ${season} AND ba.published_revision IS NOT NULL))
  )`;
}

export function brownlowStatusSql(season: string): string {
  return `CASE
    WHEN EXISTS (SELECT 1 FROM stat_availability av
      WHERE av.stat_key = 'brownlow_season_total' AND av.season = ${season}
        AND av.coverage = 'not_applicable') THEN 'not_applicable'
    WHEN ${brownlowAcceptedSql(season)}
      AND EXISTS (SELECT 1 FROM brownlow_season_votes bv WHERE bv.season = ${season})
      THEN 'complete'
    ELSE 'pending'
  END`;
}

/** Public/derived projections only. Raw reconciliation/admin evidence is retained. */
export function acceptedBrownlowRowsSql(): string {
  return `(SELECT * FROM brownlow_season_votes WHERE ${brownlowAcceptedSql('brownlow_season_votes.season')})`;
}
