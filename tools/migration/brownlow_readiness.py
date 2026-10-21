"""Existing Brownlow availability/publication decisions; no football-status inference.

Expressions are trusted internal SQL, never user input. Parity with the query helper
is tested against the same in-memory SQL fixtures. No I/O or database dependency.
"""


def accepted_sql(season: str) -> str:
    return f"""(
    NOT EXISTS (SELECT 1 FROM stat_availability av
      WHERE av.stat_key = 'brownlow_season_total' AND av.season = {season}
        AND av.coverage = 'not_applicable')
    AND (EXISTS (SELECT 1 FROM stat_availability av
      WHERE av.stat_key = 'brownlow_season_total' AND av.season = {season}
        AND av.coverage = 'complete')
      OR EXISTS (SELECT 1 FROM brownlow_season_authority ba
        WHERE ba.season = {season} AND ba.published_revision IS NOT NULL))
  )"""


def status_sql(season: str) -> str:
    return f"""CASE
    WHEN EXISTS (SELECT 1 FROM stat_availability av
      WHERE av.stat_key = 'brownlow_season_total' AND av.season = {season}
        AND av.coverage = 'not_applicable') THEN 'not_applicable'
    WHEN {accepted_sql(season)}
      AND EXISTS (SELECT 1 FROM brownlow_season_votes bv WHERE bv.season = {season})
      THEN 'complete'
    ELSE 'pending'
  END"""
