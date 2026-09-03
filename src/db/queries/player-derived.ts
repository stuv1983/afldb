import type postgres from 'postgres';

type Tx = postgres.TransactionSql;

function distinctPositiveIntegers(values: number[]): number[] {
  return Array.from(new Set(values)).filter((value) => Number.isInteger(value) && value > 0);
}

/**
 * Remove match-referencing derived rows before deleting a match. The surrounding
 * transaction will rebuild them after the authoritative rows have changed.
 */
export async function clearPlayerClubMatchReferences(tx: Tx, playerIds: number[]): Promise<void> {
  const ids = distinctPositiveIntegers(playerIds);
  if (ids.length === 0) return;
  await tx`DELETE FROM player_clubs WHERE player_id = ANY(${ids})`;
}

/**
 * Targeted counterpart of tools/migration/rebuild_derived.py for the player
 * rows affected by one match mutation. Keep the statistical definitions in
 * lockstep with that canonical full rebuild.
 */
export async function recomputePlayerDerivedStats(
  tx: Tx,
  playerIds: number[],
  season: number,
): Promise<void> {
  const ids = distinctPositiveIntegers(playerIds);
  if (ids.length === 0) return;

  await tx`
    UPDATE player_match_stats target
       SET career_game_no = ordered.game_number
      FROM (
        SELECT pms.id,
               row_number() OVER (
                 PARTITION BY pms.player_id
                 ORDER BY m.match_date, pms.match_id
               )::smallint AS game_number
        FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
        WHERE pms.player_id = ANY(${ids})
      ) ordered
     WHERE target.id = ordered.id
  `;

  await tx`DELETE FROM player_clubs WHERE player_id = ANY(${ids})`;
  await tx`
    INSERT INTO player_clubs
          (player_id, club_id, games, goals, first_season, last_season,
           first_match_id, last_match_id)
    SELECT
        pms.player_id,
        pms.club_id,
        count(*),
        COALESCE(sum(pms.goals), 0),
        min(m.season),
        max(m.season),
        (array_agg(pms.match_id ORDER BY m.match_date, pms.match_id))[1],
        (array_agg(pms.match_id ORDER BY m.match_date DESC, pms.match_id DESC))[1]
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE pms.player_id = ANY(${ids})
    GROUP BY pms.player_id, pms.club_id
  `;

  await tx`
    DELETE FROM player_club_season_stats
     WHERE player_id = ANY(${ids})
       AND season = ${season}
  `;
  await tx`
    INSERT INTO player_club_season_stats
          (player_id, season, club_id, games, finals, wins, draws, losses,
           goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
           frees_for, frees_against,
           disposals_recorded_games, tackles_recorded_games, hitouts_recorded_games, frees_recorded_games,
           is_premier)
    WITH context AS (
      SELECT
          pms.player_id,
          pms.club_id,
          m.season,
          m.is_final,
          m.is_finals_series,
          m.round_type,
          CASE
            WHEN m.result = 'draw' THEN 'D'
            WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W'
            ELSE 'L'
          END AS outcome,
          pms.goals, pms.behinds, pms.kicks, pms.handballs, pms.disposals,
          pms.marks, pms.tackles, pms.hitouts, pms.frees_for, pms.frees_against
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      WHERE pms.player_id = ANY(${ids})
        AND m.season = ${season}
    )
    SELECT
        c.player_id,
        c.season,
        c.club_id,
        count(*),
        count(*) FILTER (WHERE c.is_finals_series),
        count(*) FILTER (WHERE c.outcome = 'W'),
        count(*) FILTER (WHERE c.outcome = 'D'),
        count(*) FILTER (WHERE c.outcome = 'L'),
        sum(c.goals), sum(c.behinds), sum(c.kicks), sum(c.handballs),
        sum(c.disposals), sum(c.marks), sum(c.tackles), sum(c.hitouts),
        sum(c.frees_for), sum(c.frees_against),
        count(c.disposals), count(c.tackles), count(c.hitouts), count(c.frees_for),
        bool_or(c.round_type = 'grand_final' AND c.outcome = 'W')
    FROM context c
    GROUP BY c.player_id, c.season, c.club_id
  `;

  await tx`
    DELETE FROM player_season_stats
     WHERE player_id = ANY(${ids})
       AND season = ${season}
  `;
  await tx`
    INSERT INTO player_season_stats
          (player_id, season, primary_club_id, club_count,
           games, finals, wins, draws, losses,
           goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
           frees_for, frees_against,
           disposals_recorded_games, tackles_recorded_games, hitouts_recorded_games, frees_recorded_games,
           brownlow_votes, brownlow_status, is_premier)
    WITH season_brownlow AS (
      SELECT s.year AS season,
             CASE
               WHEN EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.season = s.year)
                 THEN 'complete'
               WHEN s.status = 'in_progress' THEN 'pending'
               ELSE 'not_applicable'
             END::coverage_status AS status
      FROM seasons s
      WHERE s.year = ${season}
    ),
    context AS (
      SELECT
          pms.player_id,
          pms.club_id,
          m.season,
          m.is_final,
          m.is_finals_series,
          m.round_type,
          CASE
            WHEN m.result = 'draw' THEN 'D'
            WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W'
            ELSE 'L'
          END AS outcome,
          pms.goals, pms.behinds, pms.kicks, pms.handballs, pms.disposals,
          pms.marks, pms.tackles, pms.hitouts, pms.frees_for, pms.frees_against,
          count(*) OVER (PARTITION BY pms.player_id, m.season, pms.club_id) AS club_games
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      WHERE pms.player_id = ANY(${ids})
        AND m.season = ${season}
    ),
    aggregate AS (
      SELECT
          c.player_id,
          c.season,
          count(*) AS games,
          count(*) FILTER (WHERE c.is_finals_series) AS finals,
          count(*) FILTER (WHERE c.outcome = 'W') AS wins,
          count(*) FILTER (WHERE c.outcome = 'D') AS draws,
          count(*) FILTER (WHERE c.outcome = 'L') AS losses,
          sum(c.goals) AS goals,
          sum(c.behinds) AS behinds,
          sum(c.kicks) AS kicks,
          sum(c.handballs) AS handballs,
          sum(c.disposals) AS disposals,
          sum(c.marks) AS marks,
          sum(c.tackles) AS tackles,
          sum(c.hitouts) AS hitouts,
          sum(c.frees_for) AS frees_for,
          sum(c.frees_against) AS frees_against,
          count(c.disposals) AS disposals_recorded_games,
          count(c.tackles) AS tackles_recorded_games,
          count(c.hitouts) AS hitouts_recorded_games,
          count(c.frees_for) AS frees_recorded_games,
          count(DISTINCT c.club_id) AS club_count,
          (array_agg(c.club_id ORDER BY c.club_games DESC, c.club_id))[1] AS primary_club_id,
          bool_or(c.round_type = 'grand_final' AND c.outcome = 'W') AS is_premier
      FROM context c
      GROUP BY c.player_id, c.season
    )
    SELECT
        a.player_id, a.season, a.primary_club_id, a.club_count,
        a.games, a.finals, a.wins, a.draws, a.losses,
        a.goals, a.behinds, a.kicks, a.handballs, a.disposals, a.marks,
        a.tackles, a.hitouts, a.frees_for, a.frees_against,
        a.disposals_recorded_games, a.tackles_recorded_games, a.hitouts_recorded_games, a.frees_recorded_games,
        CASE WHEN sb.status = 'complete' THEN COALESCE(bsv.votes, 0) END,
        sb.status,
        a.is_premier
    FROM aggregate a
    JOIN season_brownlow sb ON sb.season = a.season
    LEFT JOIN brownlow_season_votes bsv
      ON bsv.player_id = a.player_id
     AND bsv.season = a.season
  `;

  await tx`DELETE FROM player_career_stats WHERE player_id = ANY(${ids})`;
  await tx`
    INSERT INTO player_career_stats
          (player_id, games, finals, premierships, wins, draws, losses,
            goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
           frees_for, frees_against,
           behinds_recorded_games, kicks_recorded_games, handballs_recorded_games,
           disposals_recorded_games, marks_recorded_games, tackles_recorded_games,
           hitouts_recorded_games, frees_recorded_games, brownlow_votes, brownlow_medals,
           clubs_played, seasons_played, debut_season, final_season,
           debut_date, last_match_date, best_goals_game, best_disposals_game)
    WITH context AS (
      SELECT
          pms.player_id,
          cl.organization_id,
          m.season,
          m.match_date,
          m.is_final,
          m.is_finals_series,
          m.round_type,
          CASE
            WHEN m.result = 'draw' THEN 'D'
            WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W'
            ELSE 'L'
          END AS outcome,
          pms.goals, pms.behinds, pms.kicks, pms.handballs, pms.disposals,
          pms.marks, pms.tackles, pms.hitouts, pms.frees_for, pms.frees_against
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN clubs cl ON cl.id = pms.club_id
      WHERE pms.player_id = ANY(${ids})
    ),
    playing AS (
      SELECT
          c.player_id,
          count(*) AS games,
          count(*) FILTER (WHERE c.is_finals_series) AS finals,
          count(*) FILTER (WHERE c.round_type = 'grand_final' AND c.outcome = 'W') AS premierships,
          count(*) FILTER (WHERE c.outcome = 'W') AS wins,
          count(*) FILTER (WHERE c.outcome = 'D') AS draws,
          count(*) FILTER (WHERE c.outcome = 'L') AS losses,
          COALESCE(sum(c.goals), 0) AS goals,
          sum(c.behinds) AS behinds,
          sum(c.kicks) AS kicks,
          sum(c.handballs) AS handballs,
          sum(c.disposals) AS disposals,
          sum(c.marks) AS marks,
          sum(c.tackles) AS tackles,
          sum(c.hitouts) AS hitouts,
          sum(c.frees_for) AS frees_for,
          sum(c.frees_against) AS frees_against,
          count(c.behinds) AS behinds_recorded_games,
          count(c.kicks) AS kicks_recorded_games,
          count(c.handballs) AS handballs_recorded_games,
          count(c.disposals) AS disposals_recorded_games,
          count(c.marks) AS marks_recorded_games,
          count(c.tackles) AS tackles_recorded_games,
          count(c.hitouts) AS hitouts_recorded_games,
          count(c.frees_for) AS frees_recorded_games,
          count(DISTINCT c.organization_id) AS clubs_played,
          count(DISTINCT c.season) AS seasons_played,
          min(c.season) AS debut_season,
          max(c.season) AS final_season,
          min(c.match_date) AS debut_date,
          max(c.match_date) AS last_match_date,
          max(c.goals) AS best_goals_game,
          max(c.disposals) AS best_disposals_game
      FROM context c
      GROUP BY c.player_id
    ),
    brownlow AS (
      SELECT player_id,
             sum(votes) AS votes,
             count(*) FILTER (WHERE is_winner) AS medals
      FROM brownlow_season_votes
      WHERE player_id = ANY(${ids})
      GROUP BY player_id
    )
    SELECT
        p.player_id, p.games, p.finals, p.premierships, p.wins, p.draws, p.losses,
        p.goals, p.behinds, p.kicks, p.handballs, p.disposals, p.marks, p.tackles,
        p.hitouts, p.frees_for, p.frees_against,
        p.behinds_recorded_games, p.kicks_recorded_games, p.handballs_recorded_games,
        p.disposals_recorded_games, p.marks_recorded_games, p.tackles_recorded_games,
        p.hitouts_recorded_games, p.frees_recorded_games,
        COALESCE(b.votes, 0), COALESCE(b.medals, 0),
        p.clubs_played, p.seasons_played, p.debut_season, p.final_season,
        p.debut_date, p.last_match_date, p.best_goals_game, p.best_disposals_game
    FROM playing p
    LEFT JOIN brownlow b ON b.player_id = p.player_id
  `;

  // A listed player remains discoverable after their last erroneous match is removed.
  // Era-limited totals stay NULL because zero recorded games means “not recorded”.
  await tx`
    INSERT INTO player_career_stats
          (player_id, games, finals, premierships, wins, draws, losses,
            goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
           frees_for, frees_against,
           behinds_recorded_games, kicks_recorded_games, handballs_recorded_games,
           disposals_recorded_games, marks_recorded_games, tackles_recorded_games,
           hitouts_recorded_games, frees_recorded_games, brownlow_votes, brownlow_medals,
           clubs_played, seasons_played)
    SELECT
        p.id, 0, 0, 0, 0, 0, 0,
        0, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL,
        0, 0, 0, 0, 0, 0, 0, 0,
        COALESCE(b.votes, 0), COALESCE(b.medals, 0),
        0, 0
    FROM players p
    LEFT JOIN (
      SELECT player_id,
             sum(votes) AS votes,
             count(*) FILTER (WHERE is_winner) AS medals
      FROM brownlow_season_votes
      WHERE player_id = ANY(${ids})
      GROUP BY player_id
    ) b ON b.player_id = p.id
    WHERE p.id = ANY(${ids})
      AND NOT EXISTS (
        SELECT 1 FROM player_match_stats pms WHERE pms.player_id = p.id
      )
    ON CONFLICT (player_id) DO NOTHING
  `;

  await tx`
    UPDATE players p
       SET debut_season = span.debut_season,
           final_season = span.final_season
      FROM (
        SELECT selected.id AS player_id,
               min(m.season) AS debut_season,
               max(m.season) AS final_season
        FROM players selected
        LEFT JOIN player_match_stats pms ON pms.player_id = selected.id
        LEFT JOIN matches m ON m.id = pms.match_id
        WHERE selected.id = ANY(${ids})
        GROUP BY selected.id
      ) span
     WHERE p.id = span.player_id
  `;

  await tx`
    UPDATE players p
       SET search_rank = career.games
      FROM player_career_stats career
     WHERE career.player_id = p.id
       AND p.id = ANY(${ids})
  `;
}

/** Refresh season-grain Brownlow coverage after a season status transition. */
export async function recomputeSeasonBrownlowStatus(tx: Tx, season: number): Promise<void> {
  await tx`
    WITH coverage AS (
      SELECT CASE
               WHEN EXISTS (
                 SELECT 1 FROM brownlow_season_votes b WHERE b.season = s.year
               ) THEN 'complete'
               WHEN s.status = 'in_progress' THEN 'pending'
               ELSE 'not_applicable'
             END::coverage_status AS status
        FROM seasons s
       WHERE s.year = ${season}
    )
    UPDATE player_season_stats pss
       SET brownlow_status = coverage.status,
           brownlow_votes = CASE
             WHEN coverage.status = 'complete' THEN COALESCE((
               SELECT bsv.votes
                 FROM brownlow_season_votes bsv
                WHERE bsv.season = pss.season
                  AND bsv.player_id = pss.player_id
             ), 0)
             ELSE NULL
           END
      FROM coverage
     WHERE pss.season = ${season}
  `;
}

/**
 * Targeted per-season counterpart of REBUILDS["club_seasons"] in
 * tools/migration/rebuild_derived.py. Keep the two definitions in lockstep.
 *
 * AFLDB-ISSUE-095 changed what a ladder row IS. Every column is now derived
 * from AFLDB's own canonical match set rather than copied from a published
 * ladder in staging.team_seasons, whose only writer was the retired
 * AFLDB_LEGACY_SQLITE importer. The ISSUE-015 decision that stood on the old
 * shape — "score corrections do not recalculate published ladder tallies" —
 * no longer has a published tally to preserve: there is one definition, and a
 * corrected score now correctly moves the ladder. ISSUE-015 is not reopened.
 *
 * premiership_points uses the DECLARED 4/2/0 rule and ladder_rank ranks on
 * points then percentage, failing closed to NULL on an exact tie. See
 * rebuild_derived.py for the full provenance record.
 *
 * Must run after recomputeSeasonMetadata in the same transaction, because the
 * wooden-spoon completion gate reads seasons.status.
 *
 * Still fails closed, re-pointed at the new source: a season with no
 * home-and-away matches throws before anything is deleted, so the surrounding
 * mutation transaction rolls back rather than silently emptying the ladder.
 */
export async function recomputeClubSeasons(tx: Tx, season: number): Promise<void> {
  const [{ count }] = await tx<[{ count: string }]>`
    SELECT count(*) AS count FROM matches
     WHERE season = ${season} AND NOT is_final
  `;
  if (Number(count) === 0) {
    throw new Error(
      `recomputeClubSeasons: no canonical home-and-away matches for season ${season}; ` +
        'refusing to rebuild club_seasons from nothing',
    );
  }

  await tx`DELETE FROM club_seasons WHERE season = ${season}`;

  await tx`
    INSERT INTO club_seasons
          (season, club_id, played, wins, draws, losses, points_for, points_against,
           premiership_points, percentage, ladder_rank, wooden_spoon, is_premier,
           finals_played, source_id)
    WITH sides AS (
        SELECT season, home_club_id AS club_id,
               home_score AS score_for, away_score AS score_against,
               result = 'draw'               AS drew,
               winner_club_id = home_club_id AS won
          FROM matches WHERE NOT is_final AND season = ${season}
        UNION ALL
        SELECT season, away_club_id,
               away_score, home_score,
               result = 'draw',
               winner_club_id = away_club_id
          FROM matches WHERE NOT is_final AND season = ${season}
    ),
    tallies AS (
        SELECT season, club_id,
               count(*)                     AS played,
               count(*) FILTER (WHERE won)  AS wins,
               count(*) FILTER (WHERE drew) AS draws,
               sum(score_for)               AS points_for,
               sum(score_against)           AS points_against
          FROM sides GROUP BY season, club_id
    ),
    rated AS (
        SELECT t.season, t.club_id, t.played, t.wins, t.draws,
               t.played - t.wins - t.draws AS losses,
               t.points_for, t.points_against,
               t.wins * 4 + t.draws * 2 AS premiership_points,
               CASE WHEN t.points_against > 0
                    THEN t.points_for::numeric / t.points_against
               END AS ratio
          FROM tallies t
    ),
    ranked AS (
        SELECT r.*,
               rank() OVER (PARTITION BY r.season
                            ORDER BY r.premiership_points DESC,
                                     r.ratio DESC NULLS LAST)       AS pos,
               count(*) OVER (PARTITION BY r.season,
                                           r.premiership_points,
                                           r.ratio)                 AS tied,
               count(*) OVER (PARTITION BY r.season)                AS clubs_in_season
          FROM rated r
    )
    SELECT
        k.season,
        k.club_id,
        k.played, k.wins, k.draws, k.losses, k.points_for, k.points_against,
        k.premiership_points,
        round(k.ratio * 100, 4),
        -- No rank invented for an exact points-and-percentage tie.
        CASE WHEN k.tied = 1 THEN k.pos END,
        -- A wooden spoon is only awarded once a season has finished; before
        -- that, last place is a standing, not an honour.
        k.tied = 1 AND k.pos = k.clubs_in_season AND se.status = 'complete',
        COALESCE(gf.won, false),
        COALESCE(f.finals, 0),
        (SELECT id FROM sources WHERE key = 'afltables')
    FROM ranked k
    JOIN seasons se ON se.year = k.season
    LEFT JOIN (
        -- winner_club_id is NULL for a drawn Grand Final, so the 1948, 1977
        -- and 2010 draws drop out and only the replays count.
        SELECT season, winner_club_id AS club_id, true AS won
        FROM matches
        WHERE round_type = 'grand_final' AND winner_club_id IS NOT NULL
          AND season = ${season}
    ) gf ON gf.season = k.season AND gf.club_id = k.club_id
    LEFT JOIN (
        -- is_finals_series, not is_final: a Wildcard Final is not a
        -- finals-series appearance, and this column answers
        -- "made finals"/"missed finals" (nl/club-season.ts). ISSUE-129 §8.4.
        SELECT season, club_id, count(*) AS finals FROM (
            SELECT season, home_club_id AS club_id FROM matches
             WHERE is_finals_series AND season = ${season}
            UNION ALL
            SELECT season, away_club_id FROM matches
             WHERE is_finals_series AND season = ${season}
        ) x GROUP BY season, club_id
    ) f ON f.season = k.season AND f.club_id = k.club_id
  `;
}

/** Refresh the match-derived metadata held directly on one season row. */
export async function recomputeSeasonMetadata(tx: Tx, season: number): Promise<void> {
  await tx`
    UPDATE seasons s
       SET first_match_date = summary.first_match_date,
           last_match_date = summary.last_match_date,
           match_count = summary.match_count,
           club_count = summary.club_count,
           status = summary.status,
           data_through_date = summary.last_match_date,
           last_loaded_round = summary.last_loaded_round,
           completed_at = CASE WHEN summary.status = 'complete' THEN summary.last_match_date ELSE NULL END
      FROM (
        SELECT
            target.year,
            min(m.match_date) AS first_match_date,
            max(m.match_date) AS last_match_date,
            count(DISTINCT m.id)::int AS match_count,
            count(DISTINCT club.club_id)::smallint AS club_count,
            CASE
              WHEN count(m.id) = 0
              THEN 'in_progress'::season_status
              WHEN target.year = (SELECT max(season) FROM matches)
               AND NOT EXISTS (
                 SELECT 1 FROM matches decisive
                  WHERE decisive.season = target.year
                    AND decisive.round_type = 'grand_final'
                    AND decisive.result <> 'draw'
               )
              THEN 'in_progress'::season_status
              ELSE 'complete'::season_status
            END AS status,
            (
              SELECT latest.round_code
              FROM matches latest
              WHERE latest.season = target.year
              ORDER BY latest.match_date DESC, latest.id DESC
              LIMIT 1
            ) AS last_loaded_round
        FROM seasons target
        LEFT JOIN matches m ON m.season = target.year
        LEFT JOIN LATERAL (
          VALUES (m.home_club_id), (m.away_club_id)
        ) club(club_id) ON m.id IS NOT NULL
        WHERE target.year = ${season}
        GROUP BY target.year
      ) summary
     WHERE s.year = summary.year
  `;
}
