import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { recomputeClubSeasons, recomputePlayerDerivedStats, recomputeSeasonMetadata } from '@/db/queries/player-derived';

/**
 * AFLDB-ISSUE-254 — the full derived rebuild and the targeted recompute define ONE derived state.
 *
 * `recomputePlayerDerivedStats()` (every admin match mutation, the AFL API settle, the ISSUE-238
 * correction) is documented as the targeted counterpart of `tools/migration/rebuild_derived.py`.
 * Until ISSUE-254 they disagreed twice: the full rebuild never aggregated the migration-065 frees
 * columns, and it dropped the zero-games `player_career_stats` row a match-less player is given
 * (AFLDB-ISSUE-018).
 *
 * The rebuild's SQL is the REAL text of the Python module, read through `python` and never
 * re-spelled here. It runs target by target in `ORDER` against afldb_test inside ONE transaction
 * that is always rolled back: production runs each target in its own transaction with
 * `ON COMMIT DROP` temporaries, so each target's temporaries are dropped before the next. Nothing
 * is committed, so the fixture needs no cleanup and the corpus is never rewritten. The committed,
 * whole-process rebuild is proven separately (runbook §7).
 *
 * The fixture is a reserved season with three players, compared by business key over every column
 * except `player_career_stats.rebuilt_at` (DEFAULT now() in both writers):
 *   F  frees recorded in one of two games (NULL handling, recorded-game count);
 *   Z  a player whose only match row was deleted: the targeted recompute leaves the zero row,
 *      and a season Brownlow total rides on it;
 *   X  a canonical player shell that never had a career row (AFLDB-ISSUE-108): none is invented.
 */

const SEASON = 2082;
const root = process.cwd();
const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

type RebuildSql = { context: string; order: string[]; rebuilds: Record<string, string> };

function readRebuildSql(): RebuildSql {
  const script = [
    'import json, sys',
    "sys.path.insert(0, 'tools/migration')",
    'import rebuild_derived as r',
    "print(json.dumps({'context': r.PLAYER_GAME_CONTEXT, 'order': r.ORDER, 'rebuilds': r.REBUILDS}))",
  ].join('\n');
  const run = spawnSync(python, ['-c', script], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`could not read rebuild_derived.py through ${python}: ${run.stderr}`);
  return JSON.parse(run.stdout) as RebuildSql;
}

type Tx = postgres.TransactionSql;
type Keyed = Map<string, Record<string, unknown>>;

/** Every derived row of the fixture, keyed `table|business key`. */
async function snapshot(tx: Tx, playerIds: number[]): Promise<Keyed> {
  const scopes: { table: string; key: string; where: string; drop?: string }[] = [
    { table: 'player_clubs', key: 'player_id, club_id', where: 'player_id = ANY($1::int[])' },
    { table: 'player_club_season_stats', key: 'player_id, season, club_id', where: 'player_id = ANY($1::int[])' },
    { table: 'player_season_stats', key: 'player_id, season', where: 'player_id = ANY($1::int[])' },
    { table: 'player_career_stats', key: 'player_id', where: 'player_id = ANY($1::int[])', drop: 'rebuilt_at' },
    { table: 'club_seasons', key: 'season, club_id', where: `season = ${SEASON}`, drop: 'id' },
    { table: 'seasons', key: 'year', where: `year = ${SEASON}` },
    { table: 'players', key: 'id', where: 'id = ANY($1::int[])' },
  ];
  const out: Keyed = new Map();
  for (const s of scopes) {
    const rows = await tx.unsafe<{ k: string; row: Record<string, unknown> }[]>(
      `SELECT concat_ws(',', ${s.key}) AS k, to_jsonb(x) ${s.drop ? `- '${s.drop}'` : ''} AS row
         FROM ${s.table} x WHERE ${s.where}`, s.where.includes('$1') ? [playerIds] : []);
    for (const r of rows) out.set(`${s.table}|${r.k}`, r.row);
  }
  return out;
}

class RolledBack extends Error {
  constructor(readonly targeted: Keyed, readonly rebuilt: Keyed, readonly ids: { f: number; z: number; x: number; club: number }) {
    super('rolled back by design');
  }
}

describe('AFLDB-ISSUE-254 — rebuild_derived.py equals the targeted recompute', () => {
  it('produces the same frees aggregates and the same zero-games career row, and invents none', async () => {
    const rebuild = readRebuildSql();
    expect(rebuild.order).toEqual(['season_metadata', 'player_clubs', 'player_club_season_stats',
      'player_season_stats', 'player_career_stats', 'club_seasons', 'search_rank']);

    let result: RolledBack | null = null;
    try {
      await sql.begin(async (tx) => {
        // The rebuild's statements are whole-table: the app client's per-statement limit is for page reads.
        await tx`SELECT set_config('statement_timeout', '0', true)`;
        const [taken] = await tx<{ n: number }[]>`
          SELECT (SELECT count(*) FROM seasons WHERE year = ${SEASON})::int
               + (SELECT count(*) FROM matches WHERE season = ${SEASON})::int AS n`;
        if (taken.n !== 0) throw new Error(`season ${SEASON} is not free on this database`);

        const clubs = await tx<{ id: number }[]>`
          SELECT DISTINCT ON (organization_id) id::int AS id FROM clubs
           WHERE organization_id IS NOT NULL ORDER BY organization_id, id LIMIT 2`;
        const [a, b] = clubs.map((c) => c.id);
        const [{ id: sourceId }] = await tx<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
        await tx`INSERT INTO seasons (year, league, status) VALUES (${SEASON}, 'AFL', 'complete'::season_status)`;

        const match = async (key: string, date: string, home: number, away: number): Promise<number> => {
          const [row] = await tx<{ id: number }[]>`
            INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date,
                                 venue_raw, home_club_id, away_club_id, home_score, away_score, result,
                                 winner_club_id, margin, attendance_status, source_id)
            VALUES (${`issue254-${SEASON}-${key}`}, ${SEASON}, '1', 1, 'home_and_away'::round_type, false, ${date},
                    'ISSUE-254 Fixture Oval', ${home}, ${away}, 90, 70, 'home_win'::match_result, ${home}, 20,
                    'not_collected'::coverage_status, ${sourceId})
            RETURNING id::int AS id`;
          return row.id;
        };
        const m1 = await match('r1', `${SEASON}-03-20`, a, b);
        const m2 = await match('r2', `${SEASON}-03-27`, b, a);

        const player = async (slug: string): Promise<number> => {
          const [row] = await tx<{ id: number }[]>`
            INSERT INTO players (display_name, sort_name, search_name, slug)
            VALUES (${`Issue254 ${slug}`}, ${`${slug}, Issue254`}, ${`issue254 ${slug}`}, ${`issue254-${SEASON}-${slug}`})
            RETURNING id::int AS id`;
          return row.id;
        };
        const f = await player('frees');
        const z = await player('zero');
        const x = await player('shell');
        // A shell starts SETTLED: search_rank 0, as every career-rowless player on the rebuilt test databases
        // holds. No targeted writer touches X, so a NULL here would only test the rebuild's own normalisation.
        await tx`UPDATE players SET search_rank = 0 WHERE id = ${x}`;

        const stats = async (playerId: number, matchId: number, clubId: number, freesFor: number | null, freesAgainst: number | null) => {
          await tx`
            INSERT INTO player_match_stats (player_id, match_id, club_id, kicks, marks, handballs, disposals, goals,
                                            behinds, hitouts, tackles, frees_for, frees_against, source_id)
            VALUES (${playerId}, ${matchId}, ${clubId}, 12, 4, 8, 20, 2, 1, 0, 3, ${freesFor}, ${freesAgainst}, ${sourceId})`;
        };
        await stats(f, m1, a, 2, 1);
        await stats(f, m2, a, null, null);
        await stats(z, m1, b, 3, 0);
        await tx`INSERT INTO brownlow_season_votes (season, player_id, club_id, votes, source_id)
                 VALUES (${SEASON}, ${z}, ${b}, 4, ${sourceId})`;

        // The product's own settled state: season metadata and ladder, then the targeted recompute.
        await recomputeSeasonMetadata(tx, SEASON);
        await recomputeClubSeasons(tx, SEASON);
        await recomputePlayerDerivedStats(tx, [f, z], SEASON);
        // Z's only match row goes (a match-sheet removal or a match deletion does exactly this)
        // and the targeted recompute leaves Z the zero-games row.
        await tx`DELETE FROM player_match_stats WHERE player_id = ${z}`;
        await recomputePlayerDerivedStats(tx, [z], SEASON);
        const targeted = await snapshot(tx, [f, z, x]);

        for (const target of rebuild.order) {
          await tx.unsafe('DROP TABLE IF EXISTS pg_ctx; DROP TABLE IF EXISTS matchless_career;');
          await tx.unsafe(rebuild.context);
          await tx.unsafe(rebuild.rebuilds[target]);
        }
        const rebuilt = await snapshot(tx, [f, z, x]);
        throw new RolledBack(targeted, rebuilt, { f, z, x, club: a });
      });
    } catch (error) {
      if (!(error instanceof RolledBack)) throw error;
      result = error;
    }
    expect(result).not.toBeNull();
    const { targeted, rebuilt, ids } = result!;

    // The targeted recompute's own contract, so the parity below is about the right state.
    expect(targeted.get(`player_career_stats|${ids.f}`)).toMatchObject(
      { games: 2, frees_for: 2, frees_against: 1, frees_recorded_games: 1 });
    expect(targeted.get(`player_club_season_stats|${ids.f},${SEASON},${ids.club}`)).toMatchObject({ frees_for: 2, frees_against: 1, frees_recorded_games: 1 });
    expect(targeted.get(`player_season_stats|${ids.f},${SEASON}`)).toMatchObject(
      { frees_for: 2, frees_against: 1, frees_recorded_games: 1 });
    expect(targeted.get(`player_career_stats|${ids.z}`)).toMatchObject({
      games: 0, goals: 0, disposals: null, frees_for: null, frees_against: null, frees_recorded_games: 0,
      disposals_recorded_games: 0, brownlow_votes: 4, clubs_played: 0, seasons_played: 0,
    });
    expect(targeted.has(`player_career_stats|${ids.x}`)).toBe(false);

    // Parity: every business key on both sides, every column equal.
    expect([...rebuilt.keys()].sort()).toEqual([...targeted.keys()].sort());
    for (const [key, row] of targeted) expect(rebuilt.get(key), key).toEqual(row);
    // Both halves of the zero-games rule, stated outright: Z keeps its row, shell X gains none (AFLDB-ISSUE-108).
    expect(rebuilt.has(`player_career_stats|${ids.z}`)).toBe(true);
    expect(rebuilt.has(`player_career_stats|${ids.x}`)).toBe(false);
  }, 600_000);
});
