/**
 * End-to-end answer boundary checks for recognised empty result sets.
 *
 * These call answerNlQuestion through the real parser, resolver, validator
 * and grain compilers against afldb_test, but mock the telemetry sink so the
 * test can assert outcome classification synchronously.
 */
import './guard';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { sql } from '@/db/client';
import type { NlSearchLogEntry } from '@/db/queries/nl/log';

const logEntries = vi.hoisted(() => [] as NlSearchLogEntry[]);

vi.mock('@/db/queries/nl/log', () => ({
  logNlSearch: vi.fn((entry: NlSearchLogEntry) => {
    logEntries.push(entry);
  }),
}));

import { answerNlQuestion } from '@/db/queries/nl/answer';

afterEach(() => {
  logEntries.length = 0;
});

afterAll(async () => {
  await sql.end();
});

type PlayerOpponentFixture = {
  playerName: string;
  zeroOpponentName: string;
  positiveOpponentName: string;
};

async function playerOpponentFixture(): Promise<PlayerOpponentFixture> {
  const [fixture] = await sql<PlayerOpponentFixture[]>`
    WITH player_opponents AS (
      SELECT
        s.player_id,
        array_agg(DISTINCT opp_org.id) AS opponent_org_ids,
        count(*) FILTER (WHERE s.handballs IS NOT NULL) AS recorded_games
      FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN clubs player_club ON player_club.id = s.club_id
      JOIN clubs opp_club ON opp_club.id = CASE
        WHEN m.home_club_id = player_club.id THEN m.away_club_id
        ELSE m.home_club_id
      END
      JOIN club_organizations opp_org ON opp_org.id = opp_club.organization_id
      WHERE s.handballs IS NOT NULL
      GROUP BY s.player_id
      HAVING count(*) FILTER (WHERE s.handballs IS NOT NULL) > 0
    ),
    candidates AS (
      SELECT
        po.player_id,
        p.display_name AS "playerName",
        zero_org.name AS "zeroOpponentName",
        positive_org.name AS "positiveOpponentName"
      FROM player_opponents po
      JOIN players p ON p.id = po.player_id
      JOIN LATERAL (
        SELECT org.id, org.name
        FROM club_organizations org
        WHERE NOT (org.id = ANY(po.opponent_org_ids))
        ORDER BY org.name
        LIMIT 1
      ) zero_org ON true
      JOIN LATERAL (
        SELECT org.id, org.name
        FROM club_organizations org
        WHERE org.id = ANY(po.opponent_org_ids)
        ORDER BY org.name
        LIMIT 1
      ) positive_org ON true
      WHERE po.recorded_games > 0
      ORDER BY cardinality(po.opponent_org_ids) DESC, p.sort_name
      LIMIT 1
    )
    SELECT "playerName", "zeroOpponentName", "positiveOpponentName"
    FROM candidates
  `;
  expect(fixture).toBeDefined();
  return fixture;
}

describe('answerNlQuestion no-results boundary', () => {
  it('returns an NlAnswer and logs no_results for a valid supported plan with zero rows', async () => {
    const fixture = await playerOpponentFixture();
    const answer = await answerNlQuestion(
      `${fixture.playerName} total handballs against ${fixture.zeroOpponentName}`,
      null,
      'nl-answer-boundary-test',
    );

    expect(answer).not.toBeNull();
    expect(answer!.payload.kind).toBe('player_game');
    expect(answer!.headline).toMatch(/^No matching .* found$/);
    expect(answer!.headline).toBe('No matching performance found');
    expect(answer!.planToken).not.toBeNull();
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({
      outcome: 'no_results',
      failureReason: 'empty_result',
      resultCount: 0,
      grain: 'player_game',
      metric: 'handballs',
    });
  });

  it('leaves the same semantic family unchanged when rows exist', async () => {
    const fixture = await playerOpponentFixture();
    const answer = await answerNlQuestion(
      `${fixture.playerName} total handballs against ${fixture.positiveOpponentName}`,
      null,
      'nl-answer-boundary-test',
    );

    expect(answer).not.toBeNull();
    expect(answer!.payload.kind).toBe('player_game');
    if (answer!.payload.kind !== 'player_game') throw new Error(`expected player_game, got ${answer!.payload.kind}`);
    expect(answer!.payload.total).toBeGreaterThanOrEqual(1);
    expect(answer!.headline).not.toMatch(/^No matching .* found$/);
    expect(answer!.interpretation).toMatch(/^Total across /);
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]!.outcome).toMatch(/^answered/);
    expect(logEntries[0]!.failureReason).toBeUndefined();
    expect(logEntries[0]!.resultCount).toBeGreaterThanOrEqual(1);
  });

  it('still declines an unsupported metric instead of converting it to no-results', async () => {
    const answer = await answerNlQuestion(
      'Dustin Martin most moonballs against Richmond',
      null,
      'nl-answer-boundary-test',
    );

    expect(answer).toBeNull();
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({
      outcome: 'unrecognised',
      failureReason: 'unsupported_term',
    });
    expect(logEntries[0]!.outcome).not.toBe('no_results');
  });

  it('keeps historical coverage unavailable as an explicit coverage answer', async () => {
    const answer = await answerNlQuestion(
      'most tackles in 1960',
      null,
      'nl-answer-boundary-test',
    );

    expect(answer).not.toBeNull();
    expect(answer!.payload.kind).toBe('unanswerable');
    expect(answer!.headline).toMatch(/can.t answer/);
    expect(answer!.headline).not.toMatch(/^No matching .* found$/);
    expect(answer!.interpretation).toContain('not recorded');
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({
      outcome: 'unanswerable',
      failureReason: 'coverage_unavailable',
      metric: 'tackles',
    });
    expect(logEntries[0]!.outcome).not.toBe('no_results');
  });
});
