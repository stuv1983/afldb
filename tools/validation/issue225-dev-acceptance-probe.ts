/**
 * AFLDB-ISSUE-225 — read-only DEV acceptance probe for the 2026-horizon outcome (operator decision
 * D11, 2026-10-01).
 *
 *     AFLDB_ISSUE225_PROBE_DATABASE_URL=<DSN naming afldb_dev> \
 *       npx tsx --conditions=react-server tools/validation/issue225-dev-acceptance-probe.ts \
 *         [--report <new JSON file>]
 *
 * WHY A SEPARATE PROBE. The Gridley corpus suite is an integration test: tests/setup.ts refuses any
 * database whose name does not end in `_test`, because integration suites mutate their target. That
 * guard is not weakened. This probe is not a test and not a second corpus runner. It evaluates only
 * the ISSUE-225 population (tests/issue225-acceptance.ts `issue225Population`):
 *   - the 20 census captain cells;
 *   - the 15 census teammate cells;
 *   - the Swallow and Shiel census cells;
 *   - every captain cell whose frozen Gridley key omits Cameron Bruce.
 * Each is classified through the same shared helpers the corpus suite uses, and checked against the
 * one classification that passes.
 *
 * READ-ONLY, FAIL-CLOSED:
 *   - the DSN must name afldb_dev before any connection is opened;
 *   - every statement runs inside `BEGIN READ ONLY`, and the first one proves
 *     current_database() = afldb_dev and transaction_read_only = on, or the probe refuses;
 *   - the transaction always ends in ROLLBACK (a sentinel is thrown);
 *   - no fixture, no setup, no write. The only file written is the optional --report JSON, which
 *     must not exist yet.
 *
 * EXIT: 0 = every cell classified as expected, every record current; 1 = any failure (named);
 * 2 = refused (usage or target).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { mapGridleyCriterion, type GridleyItem, type GridleyLookups, type GridleyMapping } from '@/search/gridley-compat';

import {
  buildCoachResolver, buildCriterionListingIndex, buildResolver, criterionListedElsewhere, knownAnswerEvidenceStaleness,
  type CoachRow, type KnownAnswerRecord, type PlayerRow,
} from '../../tests/gridley-corpus-support';
import { loadGridleyKnownAnswerAdjudications } from '../../tests/gridley-known-answer-adjudications';
import {
  classifyIssue225Cell, GAMES_CENSUS, ISSUE225_GIDS, issue225Population, TEAMMATE_CENSUS, CAPTAIN_CENSUS,
  type Issue225Category, type Issue225Cell,
} from '../../tests/issue225-acceptance';

const EXPECTED_DATABASE = 'afldb_dev';
const FIXTURES = join(__dirname, '..', '..', 'tests', 'fixtures', 'gridley');

class Refused extends Error {}

type CellResult = Issue225Cell & { afldbPlayer: number; actual: Issue225Category; detail: string; ok: boolean };
type ProbeResult = {
  target: { database: string; readOnly: string; port: number | null; observedAt: string; maxSeason: number };
  records: { profile: string; criterion: string; direction: string; afldbPlayer: number | null; status: string }[];
  teammateCounts: { gid: number; afldbPlayer: number; playedTeammates: number }[];
  excluded: { board: number; cell: string; criterion: string }[];
  counts: Record<string, Record<string, number>>;
  failures: string[];
  cells: CellResult[];
};

function parseArgs(argv: string[]): { report: string | null } {
  let report: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report' && argv[i + 1]) { report = argv[++i]; continue; }
    throw new Refused(`unknown argument ${argv[i]} (usage: [--report <new JSON file>])`);
  }
  if (report !== null && existsSync(report)) throw new Refused(`--report ${report} already exists; refusing to overwrite`);
  return { report };
}

function targetDsn(): string {
  const dsn = process.env.AFLDB_ISSUE225_PROBE_DATABASE_URL?.trim();
  if (!dsn) throw new Refused('AFLDB_ISSUE225_PROBE_DATABASE_URL is not set');
  let named: string;
  try {
    named = decodeURIComponent(new URL(dsn).pathname.replace(/^\//, ''));
  } catch {
    throw new Refused('AFLDB_ISSUE225_PROBE_DATABASE_URL is not a valid connection URL');
  }
  if (named !== EXPECTED_DATABASE) throw new Refused(`the DSN names '${named}'; this probe runs against ${EXPECTED_DATABASE} only`);
  return dsn;
}

async function main(argv: string[]): Promise<number> {
  const { report } = parseArgs(argv);
  // src/db/client.ts builds its pool from DATABASE_URL at import time: set it, then import.
  process.env.DATABASE_URL = targetDsn();
  const { sql } = await import('@/db/client');
  const { compileAxis } = await import('@/db/queries/grid-solver');

  const boards = (JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8')) as {
    boards: { board: number; date: string; rows: GridleyItem[]; cols: GridleyItem[] }[];
  }).boards;
  const answers = JSON.parse(gunzipSync(readFileSync(join(FIXTURES, 'corpus-answers.json.gz'))).toString('utf8')) as Record<string, number[][][]>;

  let result: ProbeResult | null = null;
  class Rollback extends Error { constructor(readonly value: ProbeResult) { super('rollback'); } }
  try {
    await sql.begin('read only', async (tx) => {
      const [g] = await tx<{ database: string; readOnly: string; port: number | null; observedAt: string; maxSeason: number }[]>`
        SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly",
               inet_server_port() AS port, now()::text AS "observedAt", (SELECT max(season) FROM matches)::int AS "maxSeason"`;
      if (g.database !== EXPECTED_DATABASE || g.readOnly !== 'on') {
        throw new Refused(`connected to ${g.database} with transaction_read_only=${g.readOnly}; refusing`);
      }
      const failures: string[] = [];

      // Lookups, exactly as the corpus suite builds them.
      const [clubs, venues, awards, players, coaches, profiles] = await Promise.all([
        tx<{ slug: string; id: number }[]>`SELECT slug, id FROM club_organizations`,
        tx<{ name: string; id: number }[]>`SELECT canonical_name AS name, id FROM venues`,
        tx<{ slug: string; id: number }[]>`SELECT slug, id FROM awards`,
        tx<PlayerRow[]>`SELECT p.id, p.display_name AS "displayName", p.given_name AS "givenName", p.surname,
                               c.debut_season AS "debutSeason", c.final_season AS "finalSeason"
                          FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id`,
        tx<CoachRow[]>`SELECT id, display_name AS "displayName" FROM coaches`,
        tx<{ playerId: number; profile: string }[]>`SELECT ei.player_id AS "playerId", ei.external_id AS profile
                                                      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
                                                     WHERE s.key = 'afltables'`,
      ]);
      const unresolvedLog: string[] = [];
      const gapLog: string[] = [];
      const lookups: GridleyLookups = {
        clubs: Object.fromEntries(clubs.map((c) => [c.slug, c.id])),
        venues: Object.fromEntries(venues.map((v) => [v.name, v.id])),
        awards: Object.fromEntries(awards.map((a) => [a.slug, a.id])),
        resolvePlayer: buildResolver(players, unresolvedLog, gapLog, g.maxSeason),
        resolveCoach: buildCoachResolver(coaches, unresolvedLog, gapLog),
      };
      const items = new Map<string, GridleyItem>();
      for (const b of boards) for (const item of [...b.rows, ...b.cols]) if (!items.has(item.id)) items.set(item.id, item);
      const mappings = new Map<string, GridleyMapping>();
      const mappingOf = (id: string) => {
        if (!mappings.has(id)) mappings.set(id, mapGridleyCriterion(items.get(id)!, lookups));
        return mappings.get(id)!;
      };
      const builderOf = (id: string) => {
        const m = mappingOf(id);
        if (m.status === 'mapped') return m.axis.builder;
        if (m.status === 'unsupported') return null;
        failures.push(`criterion ${id} did not map on ${EXPECTED_DATABASE}: ${m.status}${'reason' in m ? ` (${m.reason})` : ''}`);
        return null;
      };

      // Bridge each ISSUE-225 Gridley id through the corpus' own player-valued criterion.
      const gids = [...new Set([...CAPTAIN_CENSUS, ...TEAMMATE_CENSUS, ...GAMES_CENSUS].map(([, , gid]) => gid).concat(ISSUE225_GIDS.BRUCE))];
      const bridge = new Map<number, number>();
      for (const gid of gids) {
        const criterion = [...items.keys()].find((id) => new RegExp(`-(?:teammate|gf-opp)-${gid}$`).test(id));
        const m = criterion ? mappingOf(criterion) : null;
        if (m?.status === 'mapped' && m.axis.params.player) bridge.set(gid, Number(m.axis.params.player));
        else failures.push(`Gridley player ${gid} does not bridge to an AFLDB player on ${EXPECTED_DATABASE}`);
      }

      const { cells, excluded } = issue225Population(boards, answers, builderOf);
      const ids = [...new Set(bridge.values())];

      // AFLDB eligibility of the ISSUE-225 players on every criterion the population uses,
      // through the production compiler.
      const eligible = new Map<string, Set<number>>();
      for (const id of new Set(cells.flatMap((c) => [c.row, c.col]))) {
        const m = mappingOf(id);
        if (m.status !== 'mapped') continue;
        const rows = await tx<{ id: number }[]>`
          SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id
           WHERE p.id = ANY(${ids}::int[]) AND ${compileAxis(m.axis)}`;
        eligible.set(id, new Set(rows.map((r) => r.id)));
      }

      // The teammates semantic guard's count, at career_teammates_min's own grain.
      const teammateIds = [...new Set(TEAMMATE_CENSUS.map(([, , gid]) => bridge.get(gid)).filter((x): x is number => x !== undefined))];
      const teammateRows = await tx<{ playerId: number; teammates: number }[]>`
        SELECT pcs.player_id AS "playerId", count(DISTINCT o.player_id)::int AS teammates
          FROM player_club_season_stats pcs
          JOIN player_club_season_stats o ON o.season = pcs.season AND o.club_id = pcs.club_id AND o.player_id <> pcs.player_id
         WHERE pcs.player_id = ANY(${teammateIds}::int[])
         GROUP BY pcs.player_id`;
      const playedTeammates = new Map(teammateRows.map((r) => [r.playerId, r.teammates]));

      // The three tracked adjudications: resolved by AFL Tables profile, re-derived, never stale.
      const byProfile = new Map(profiles.map((p) => [p.profile, p.playerId]));
      const adjudications = loadGridleyKnownAnswerAdjudications();
      const adjudicatedIds = adjudications.flatMap((a) => (byProfile.has(a.afltablesProfile) ? [byProfile.get(a.afltablesProfile)!] : []));
      const [organizationGames, trustedCaptaincies] = await Promise.all([
        tx<{ playerId: number; slug: string; games: number }[]>`
          SELECT pc.player_id AS "playerId", o.slug, sum(pc.games)::int AS games
            FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
            JOIN club_organizations o ON o.id = COALESCE((SELECT r.to_organization_id FROM club_organization_relations r
                                                           WHERE r.from_organization_id = cl.organization_id AND r.relation = 'merged_into'), cl.organization_id)
           WHERE pc.player_id = ANY(${adjudicatedIds}::int[])
           GROUP BY pc.player_id, o.slug`,
        tx<{ playerId: number; club: string; season: number }[]>`
          SELECT cp.player_id AS "playerId", c.name AS club, cp.season::int AS season
            FROM captaincies cp JOIN clubs c ON c.id = cp.club_id
           WHERE cp.player_id = ANY(${adjudicatedIds}::int[]) AND cp.link_status_value IN ('unique', 'resolved')`,
      ]);
      const records = new Map<number, KnownAnswerRecord[]>();
      const recordStatus: ProbeResult['records'] = [];
      for (const adj of adjudications) {
        const playerId = byProfile.get(adj.afltablesProfile) ?? null;
        const base = { profile: adj.afltablesProfile, criterion: adj.gridleyCriterion, direction: adj.direction, afldbPlayer: playerId };
        if (playerId === null) {
          recordStatus.push({ ...base, status: 'UNRESOLVED: no afltables identity' });
          failures.push(`adjudication ${adj.afltablesProfile} ${adj.gridleyCriterion} does not resolve on ${EXPECTED_DATABASE}`);
          continue;
        }
        const stale = knownAnswerEvidenceStaleness(adj, {
          organizationGames: organizationGames.filter((r) => r.playerId === playerId),
          trustedCaptaincies: trustedCaptaincies.filter((r) => r.playerId === playerId),
        });
        records.set(playerId, [...(records.get(playerId) ?? []), { ...adj, stale }]);
        recordStatus.push({ ...base, status: stale === null ? 'current' : `STALE: ${stale}` });
        if (stale !== null) failures.push(`adjudication ${adj.afltablesProfile} ${adj.gridleyCriterion} is STALE: ${stale}`);
      }

      // Classify every population cell and hold it to its one passing classification.
      const listing = buildCriterionListingIndex(boards, answers, new Set(bridge.keys()));
      const finalSeasons = new Map(players.map((p) => [p.id, p.finalSeason]));
      const results: CellResult[] = [];
      for (const cell of cells) {
        const afldbPlayer = bridge.get(cell.gid);
        const [rowSet, colSet] = [eligible.get(cell.row), eligible.get(cell.col)];
        if (afldbPlayer === undefined || !rowSet || !colSet) {
          failures.push(`#${cell.board} ${cell.cell} [${cell.group}] ${cell.row} x ${cell.col}: not evaluable (${afldbPlayer === undefined ? 'unbridged player' : 'an axis did not map'})`);
          continue;
        }
        const builders = [mappingOf(cell.row), mappingOf(cell.col)].map((m) => (m.status === 'mapped' ? m.axis.builder : '')) as [string, string];
        const ti = builders.indexOf('career_teammates_min');
        const tm = ti >= 0 ? mappingOf(ti === 0 ? cell.row : cell.col) : null;
        const { category, detail } = classifyIssue225Cell({
          inGridley: (answers[String(cell.board)][Number(cell.cell[0])][Number(cell.cell[2])] ?? []).includes(cell.gid),
          axisCriteria: [cell.row, cell.col], axisBuilders: builders, axisHas: [rowSet.has(afldbPlayer), colSet.has(afldbPlayer)],
          finalSeason: finalSeasons.get(afldbPlayer) ?? null, boardYear: Number(cell.date.slice(0, 4)), maxSeason: g.maxSeason,
          records: records.get(afldbPlayer),
          gridleyListsElsewhere: (criterion) => criterionListedElsewhere(listing, cell.gid, criterion, cell.board, cell.cell),
          playedTeammates: playedTeammates.get(afldbPlayer) ?? 0,
          teammateThreshold: tm?.status === 'mapped' ? Number(tm.axis.params.x) : null,
        });
        const ok = category === cell.expected;
        results.push({ ...cell, afldbPlayer, actual: category, detail, ok });
        if (category === 'incorrect known answer') failures.push(`#${cell.board} ${cell.cell} [${cell.group}] ${cell.row} x ${cell.col}: incorrect known answer :: ${detail}`);
        else if (!ok && cell.expected === 'agreement') failures.push(`#${cell.board} ${cell.cell} [${cell.group}] ${cell.row} x ${cell.col}: unexpected ISSUE-225 cell (${category}, expected agreement) :: ${detail}`);
        else if (!ok) failures.push(`#${cell.board} ${cell.cell} [${cell.group}] ${cell.row} x ${cell.col}: expected ISSUE-225 cell missing (${category}, expected ${cell.expected}) :: ${detail}`);
      }

      // The teammates guard must carry AFLDB's actual count, and that count must be below the bound.
      const teammateCounts: ProbeResult['teammateCounts'] = [];
      for (const r of results.filter((x) => x.group === 'teammate census')) {
        const n = playedTeammates.get(r.afldbPlayer) ?? 0;
        teammateCounts.push({ gid: r.gid, afldbPlayer: r.afldbPlayer, playedTeammates: n });
        if (r.actual === 'adjudicated key disagreement' && !r.detail.includes(`computes ${n} played teammates`)) {
          failures.push(`#${r.board} ${r.cell}: the teammates detail does not carry AFLDB's count ${n}`);
        }
      }
      for (const u of unresolvedLog) failures.push(`unresolved reference: ${u}`);

      const counts: Record<string, Record<string, number>> = {};
      for (const r of results) {
        counts[r.group] ??= {};
        counts[r.group][r.actual] = (counts[r.group][r.actual] ?? 0) + 1;
      }
      throw new Rollback({
        target: g, records: recordStatus, teammateCounts, excluded, counts, failures,
        cells: results.filter((r) => !r.ok || r.actual !== 'agreement'),
      });
    });
  } catch (err) {
    if (err instanceof Rollback) result = err.value;
    else throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const r = result!;
  console.log(`[issue225-probe] ${r.target.database} (read-only=${r.target.readOnly}, port ${r.target.port}, horizon ${r.target.maxSeason}) at ${r.target.observedAt}; transaction rolled back`);
  for (const rec of r.records) console.log(`[issue225-probe] adjudication ${rec.profile} ${rec.criterion}/${rec.direction} -> afldb ${rec.afldbPlayer}: ${rec.status}`);
  for (const t of r.teammateCounts) console.log(`[issue225-probe] teammates gridley ${t.gid} = afldb ${t.afldbPlayer}: ${t.playedTeammates} played teammates`);
  for (const [group, byCategory] of Object.entries(r.counts)) console.log(`[issue225-probe] ${group}: ${JSON.stringify(byCategory)}`);
  console.log(`[issue225-probe] excluded (unsupported other axis): ${r.excluded.map((e) => `#${e.board} ${e.cell} ${e.criterion}`).join('; ') || 'none'}`);
  for (const f of r.failures) console.log(`[issue225-probe] FAIL ${f}`);
  if (report) writeFileSync(report, JSON.stringify(r, null, 1));
  console.log(`[issue225-probe] ${r.failures.length === 0 ? 'PASS' : `FAIL (${r.failures.length})`}`);
  return r.failures.length === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err: unknown) => {
    if (err instanceof Refused) {
      console.error(`[issue225-probe] REFUSED: ${err.message}`);
      process.exitCode = 2;
    } else {
      console.error(`[issue225-probe] ERROR: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exitCode = 1;
    }
  },
);
