import 'server-only';

import { sql } from '@/db/client';
import { clubPath } from '@/lib/format';
import type { NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload } from '@/search/nl/answer-types';

/**
 * FS6 -- the distribution of AFL father-son SELECTIONS, by the club that
 * made them and by the year they were made (AFLDB-ISSUE-153 Stage 4).
 *
 * THE DENOMINATOR IS THE POINT OF THIS FILE, and it is an operator
 * decision (Q2), not a default.
 *
 * Every other NL surface counts LINKED players, because a player list
 * cannot honestly show a name it has not resolved to an identity. A
 * distribution is a different question: "how many father-son selections
 * has Carlton made" is a question about SELECTIONS, and a selection whose
 * player AFLDB has not linked still happened. So this counts all 127
 * selection rows, not the 99 whose selected player is linked.
 *
 * The two are not close. Measured read-only on afldb_test (Stage 0 §4.5),
 * the two denominators change 14 of the 17 organizations, and for two of
 * them they change most of the answer:
 *
 *     Carlton      13 selections   ->  7 linked players
 *     Geelong      14              -> 10
 *     Collingwood  17              -> 15
 *     Adelaide      4              ->  1
 *
 * The 99 is not hidden: it is disclosed in the answer alongside the
 * distribution, so a reader who wants linked identities is told the
 * number rather than left to assume this one is it. What it must never do
 * is quietly become the denominator.
 *
 * No link filter appears anywhere below. That is deliberate, and a future
 * edit that adds one is a semantic change to the answer, not a tightening.
 */
export async function answerFatherSonSummary(plan: NlQueryPlan): Promise<NlAnswerPayload> {
  const kind = plan.fatherSonSummary!.kind;

  // One statement for both figures, so the disclosed coverage can never
  // drift from the population it is disclosed against.
  const [counts] = await sql<{ selections: number; linkedPlayers: number }[]>`
    SELECT count(*)::int AS selections,
           count(DISTINCT drafted_player_id) FILTER (
             WHERE drafted_player_id IS NOT NULL
               AND drafted_link_status IN ('unique', 'resolved')
           )::int AS "linkedPlayers"
      FROM father_son_selections
  `;

  const base = {
    kind: 'achievement_summary' as const,
    achievementLabel: 'Selected under the AFL father–son rule',
    total: counts.selections,
    unit: { one: 'father–son selection', many: 'father–son selections' },
    disclosure: `${counts.linkedPlayers.toLocaleString('en-AU')} of those selections name a player `
      + 'AFLDB has linked to a profile; the rest name a player it has not, and are still counted here '
      + 'because the selection was still made.',
  };

  if (kind === 'by_club') {
    // Grouped by ORGANIZATION, the club lineage rule every club aggregate
    // in this codebase follows: a rename combines (North Melbourne and the
    // Kangaroos are one lineage, 7 selections; Footscray and the Western
    // Bulldogs are one, 11), a MERGER does not, so Fitzroy's single 1993
    // selection stays Fitzroy's and is never folded into Brisbane. An
    // inner join is safe and checked: no selection has a null club_id.
    const rows = await sql<{ label: string; value: number; slug: string }[]>`
      SELECT o.name AS label, count(*)::int AS value, o.slug
        FROM father_son_selections f
        JOIN clubs cl ON cl.id = f.club_id
        JOIN club_organizations o ON o.id = cl.organization_id
       GROUP BY o.id, o.name, o.slug
       ORDER BY count(*) DESC, o.name
    `;
    return {
      ...base,
      groupBy: 'club',
      rows: rows.map((r) => ({ label: r.label, value: r.value, href: clubPath(r.slug) })),
    };
  }

  // Chronological, not count-descending: a run of draft years is read as a
  // timeline, and re-sorting it by size would hide the shape it is being
  // asked for. No href -- a draft year is not a season page, and 0 of the
  // 99 linked selected players debuted in the season they were drafted, so
  // linking one to the other would assert exactly the thing that is false.
  const rows = await sql<{ draftYear: number; value: number }[]>`
    SELECT f.draft_year AS "draftYear", count(*)::int AS value
      FROM father_son_selections f
     GROUP BY f.draft_year
     ORDER BY f.draft_year
  `;
  return {
    ...base,
    groupBy: 'draft_year',
    rows: rows.map((r) => ({ label: String(r.draftYear), value: r.value, href: null })),
  };
}
