import 'server-only';

import { sql } from '@/db/client';

/**
 * Coaches for a picker, e.g. the grid solver's Coaching category.
 *
 * One row per person who coached (AFLDB-ISSUE-118 §23.27), labelled with the
 * span of seasons match_coaches records for them so two coaches who share a
 * surname read apart. Every coach is listed, whether or not they also played.
 */
export async function getCoachOptions() {
  return sql<{ id: number; name: string }[]>`
    SELECT c.id,
           c.display_name
             || COALESCE(' (' || min(m.season)::text || '–' || max(m.season)::text || ')', '') AS name
      FROM coaches c
      LEFT JOIN match_coaches mc ON mc.coach_id = c.id
      LEFT JOIN matches m ON m.id = mc.match_id
     GROUP BY c.id, c.display_name
     ORDER BY c.surname, c.given_name, c.display_name
  `;
}
