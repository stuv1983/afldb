/**
 * ISSUE-118 §23.12 / §23.16: the shared oracle scaffold for answer-key
 * comparisons against the test database. Every criterion set is computed
 * once (about a minute), every cell with both axes usable is intersected,
 * and Gridley's opaque player ids are bridged to AFLDB players two ways:
 *
 *   - name bridge: the player-valued criteria name a player, so a unique
 *     name resolution is a bridge entry;
 *   - fingerprint bridge: a Gridley id and an AFLDB player that occupy the
 *     same cells across the corpus are the same person (Jaccard >= 0.7 over
 *     cell memberships, second candidate below half the best, injective).
 *
 * The union prefers the name bridge. Not a test in itself: imported by the
 * opt-in oracle tests (All-Australian, height), which report, never gate.
 */
import { sql } from '@/db/client';
import { compileAxis } from '@/db/queries/grid-solver';
import { mapGridleyCriterion, normalisePlayerName, type GridleyLookups, type GridleyMapping } from '@/search/gridley-compat';
import type { GridAxisState } from '@/search/grid-solver-spec';
import { loadAnswers, loadCorpus, type CorpusBoard } from '../gridley-compat.test';

export type PlayerRow = { id: number; displayName: string; givenName: string | null; surname: string | null; debutSeason: number | null; finalSeason: number | null };
export type Cell = { board: number; r: number; c: number; row: string; col: string; a: number[]; g: number[] };

export type GridleyOracle = {
  boards: CorpusBoard[];
  players: PlayerRow[];
  playerById: Map<number, PlayerRow>;
  mappings: Map<string, GridleyMapping>;
  sets: Map<string, Set<number>>;
  cells: Cell[];
  /** gridley id -> afldb id (name wins where both bridges exist). */
  bridge: Map<number, number>;
  /** afldb id -> gridley id. */
  inverse: Map<number, number>;
  nameBridge: Map<number, number>;
  fingerprint: Map<number, { afldb: number; score: number; second: number }>;
  agree: number;
  disagree: number;
  disagreements: string[];
  log: (msg: string) => void;
};

async function eligible(axis: GridAxisState): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id WHERE ${compileAxis(axis)}`;
  return rows.map((r) => r.id);
}

export async function buildGridleyOracle(tag: string): Promise<GridleyOracle> {
  const log = (msg: string) => console.log(`[${tag}] ${msg}`);
  const boards = loadCorpus();
  const answers = loadAnswers();
  const [clubs, venues, awards, players] = await Promise.all([
    sql<{ slug: string; id: number }[]>`SELECT slug, id FROM club_organizations`,
    sql<{ name: string; id: number }[]>`SELECT canonical_name AS name, id FROM venues`,
    sql<{ slug: string; id: number }[]>`SELECT slug, id FROM awards`,
    sql<PlayerRow[]>`SELECT p.id, p.display_name AS "displayName", p.given_name AS "givenName", p.surname,
                            c.debut_season AS "debutSeason", c.final_season AS "finalSeason"
                       FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id`,
  ]);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const byName = new Map<string, PlayerRow[]>();
  for (const p of players) {
    for (const k of new Set([normalisePlayerName(p.displayName), normalisePlayerName(`${p.givenName ?? ''} ${p.surname ?? ''}`)])) {
      if (!k) continue;
      const l = byName.get(k) ?? []; l.push(p); byName.set(k, l);
    }
  }
  const nameBridge = new Map<number, number>(); // gridley id -> afldb id (unique-name teammate criteria only)
  const lookups: GridleyLookups = {
    clubs: Object.fromEntries(clubs.map((c) => [c.slug, c.id])),
    venues: Object.fromEntries(venues.map((v) => [v.name, v.id])),
    awards: Object.fromEntries(awards.map((a) => [a.slug, a.id])),
    resolvePlayer: (ref) => {
      const c = byName.get(normalisePlayerName(ref.name)) ?? [];
      if (c.length !== 1) return null;
      if (ref.gridleyPlayerId !== null) nameBridge.set(ref.gridleyPlayerId, c[0].id);
      return c[0].id;
    },
  };

  // Criterion sets.
  const mappings = new Map<string, GridleyMapping>();
  const sets = new Map<string, Set<number>>();
  for (const b of boards) for (const it of [...b.rows, ...b.cols]) {
    if (mappings.has(it.id)) continue;
    mappings.set(it.id, mapGridleyCriterion(it, lookups));
  }
  let n = 0;
  for (const [id, m] of mappings) {
    if (m.status !== 'mapped') continue;
    try { sets.set(id, new Set(await eligible(m.axis))); } catch { /* gap */ }
    if (++n % 100 === 0) log(`${n} criterion sets`);
  }

  // Cells (both axes usable).
  const cells: Cell[] = [];
  for (const b of boards) {
    const key = answers[String(b.board)];
    b.rows.forEach((ri, r) => b.cols.forEach((ci, c) => {
      const mr = mappings.get(ri.id)!; const mc = mappings.get(ci.id)!;
      const sr = mr.status === 'freebie' ? null : sets.get(ri.id);
      const sc = mc.status === 'freebie' ? null : sets.get(ci.id);
      if ((mr.status !== 'freebie' && !sr) || (mc.status !== 'freebie' && !sc)) return;
      let a: number[];
      if (sr && sc) a = [...sr].filter((x) => sc.has(x));
      else a = [...(sr ?? sc ?? [])];
      cells.push({ board: b.board, r, c, row: ri.id, col: ci.id, a, g: key[r][c] });
    }));
  }
  log(`cells usable ${cells.length}`);

  // Fingerprint bridge.
  const pIdx = new Map<number, number>(); const pIds: number[] = [];
  for (const p of players) { pIdx.set(p.id, pIds.length); pIds.push(p.id); }
  const gIdx = new Map<number, number>(); const gIds: number[] = [];
  const cellsOfG: number[][] = [];
  const nA = new Int32Array(pIds.length);
  const cellA: Int32Array[] = [];
  cells.forEach((cell, ci) => {
    const arr = new Int32Array(cell.a.length);
    cell.a.forEach((id, i) => { const k = pIdx.get(id)!; arr[i] = k; nA[k]++; });
    cellA.push(arr);
    for (const g of cell.g) {
      let k = gIdx.get(g);
      if (k === undefined) { k = gIds.length; gIdx.set(g, k); gIds.push(g); cellsOfG.push([]); }
      cellsOfG[k].push(ci);
    }
  });
  const counts = new Int32Array(pIds.length);
  const fingerprint = new Map<number, { afldb: number; score: number; second: number }>();
  const claimed = new Map<number, number>(); // afldb -> gridley
  for (let k = 0; k < gIds.length; k++) {
    const cl = cellsOfG[k];
    if (cl.length < 2) continue;
    const touched: number[] = [];
    for (const ci of cl) for (const p of cellA[ci]) { if (counts[p]++ === 0) touched.push(p); }
    let best = -1, bestS = 0, secondS = 0;
    for (const p of touched) {
      const s = counts[p] / (cl.length + nA[p] - counts[p]);
      if (s > bestS) { secondS = bestS; bestS = s; best = p; } else if (s > secondS) secondS = s;
      counts[p] = 0;
    }
    if (best >= 0 && bestS >= 0.7 && secondS < 0.5 * bestS) {
      const afldb = pIds[best];
      const prior = claimed.get(afldb);
      if (prior !== undefined) { fingerprint.delete(prior); continue; }
      claimed.set(afldb, gIds[k]);
      fingerprint.set(gIds[k], { afldb, score: bestS, second: secondS });
    }
  }
  let agree = 0, disagree = 0; const disagreements: string[] = [];
  for (const [g, id] of nameBridge) {
    const f = fingerprint.get(g);
    if (!f) continue;
    if (f.afldb === id) agree++; else { disagree++; disagreements.push(`${g}: name ${id} ${playerById.get(id)?.displayName} vs fingerprint ${f.afldb} ${playerById.get(f.afldb)?.displayName} (${f.score.toFixed(2)})`); }
  }
  log(`fingerprint bridge ${fingerprint.size} of ${gIds.length} gridley ids; vs name bridge agree ${agree} disagree ${disagree}`);
  // Union bridge: name wins where both exist.
  const bridge = new Map<number, number>();
  for (const [g, f] of fingerprint) bridge.set(g, f.afldb);
  for (const [g, id] of nameBridge) bridge.set(g, id);
  const inverse = new Map<number, number>(); for (const [g, id] of bridge) inverse.set(id, g);

  return { boards, players, playerById, mappings, sets, cells, bridge, inverse, nameBridge, fingerprint, agree, disagree, disagreements, log };
}
