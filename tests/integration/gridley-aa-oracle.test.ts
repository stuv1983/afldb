/**
 * ISSUE-118 §23.12: All-Australian answer-key comparison against the test
 * database, using Gridley's stored per-cell answer keys as the external
 * oracle. Opt-in (set AFLDB_AA_REPORT=<file>): it computes every criterion
 * set, so it costs about a minute and is a diagnostic, not a gate. The
 * 2026-09-05 run and its conclusions are in issues/open/AFLDB-ISSUE-118.md.
 *
 * Bridge: Gridley player ids are opaque, so besides the name bridge for the
 * player-valued criteria this builds a co-occurrence fingerprint bridge --
 * a Gridley id and an AFLDB player that sit in the same cells across the
 * whole corpus are the same person. Validated against the name bridge.
 */
import './guard';

import { writeFileSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { compileAxis } from '@/db/queries/grid-solver';
import { mapGridleyCriterion, normalisePlayerName, type GridleyLookups, type GridleyMapping } from '@/search/gridley-compat';
import type { GridAxisState } from '@/search/grid-solver-spec';
import { loadAnswers, loadCorpus } from '../gridley-compat.test';

afterAll(async () => { await sql.end(); });

const OUT = process.env.AFLDB_AA_REPORT;

type PlayerRow = { id: number; displayName: string; givenName: string | null; surname: string | null; debutSeason: number | null; finalSeason: number | null };
type AaRow = { playerId: number; season: number; club: string | null; key: string };

async function eligible(axis: GridAxisState): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id WHERE ${compileAxis(axis)}`;
  return rows.map((r) => r.id);
}

describe('ISSUE-118 All-Australian oracle', () => {
  it.skipIf(!OUT)('compares AFLDB against Gridley answer keys', async () => {
    const boards = loadCorpus();
    const answers = loadAnswers();
    const [clubs, venues, awards, players, aaRows] = await Promise.all([
      sql<{ slug: string; id: number }[]>`SELECT slug, id FROM club_organizations`,
      sql<{ name: string; id: number }[]>`SELECT canonical_name AS name, id FROM venues`,
      sql<{ slug: string; id: number }[]>`SELECT slug, id FROM awards`,
      sql<PlayerRow[]>`SELECT p.id, p.display_name AS "displayName", p.given_name AS "givenName", p.surname,
                              c.debut_season AS "debutSeason", c.final_season AS "finalSeason"
                         FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id`,
      sql<AaRow[]>`SELECT w.player_id AS "playerId", w.season::int AS season, w.club_name_raw AS club, w.source_record_id AS key
                     FROM award_winners w JOIN awards a ON a.id = w.award_id
                    WHERE a.slug = 'all-australian' AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')`,
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
      if (++n % 100 === 0) console.log(`[aa-oracle] ${n} criterion sets`);
    }

    // Cells (both axes usable).
    type Cell = { board: number; r: number; c: number; row: string; col: string; a: number[]; g: number[] };
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
    console.log(`[aa-oracle] cells usable ${cells.length}`);

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
    const bridge = new Map<number, { afldb: number; score: number; second: number }>();
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
        if (prior !== undefined) { bridge.delete(prior); continue; }
        claimed.set(afldb, gIds[k]);
        bridge.set(gIds[k], { afldb, score: bestS, second: secondS });
      }
    }
    let agree = 0, disagree = 0; const disagreements: string[] = [];
    for (const [g, id] of nameBridge) {
      const f = bridge.get(g);
      if (!f) continue;
      if (f.afldb === id) agree++; else { disagree++; disagreements.push(`${g}: name ${id} ${playerById.get(id)?.displayName} vs fingerprint ${f.afldb} ${playerById.get(f.afldb)?.displayName} (${f.score.toFixed(2)})`); }
    }
    console.log(`[aa-oracle] fingerprint bridge ${bridge.size} of ${gIds.length} gridley ids; vs name bridge agree ${agree} disagree ${disagree}`);
    // Union bridge: name wins where both exist.
    const B = new Map<number, number>();
    for (const [g, f] of bridge) B.set(g, f.afldb);
    for (const [g, id] of nameBridge) B.set(g, id);
    const inv = new Map<number, number>(); for (const [g, id] of B) inv.set(id, g);

    // AFLDB AA facts.
    const aaByPlayer = new Map<number, AaRow[]>();
    for (const r of aaRows) { const l = aaByPlayer.get(r.playerId) ?? []; l.push(r); aaByPlayer.set(r.playerId, l); }
    const desc = (id: number) => {
      const p = playerById.get(id); const aa = (aaByPlayer.get(id) ?? []).sort((x, y) => x.season - y.season);
      return `${id} ${p?.displayName} [${p?.debutSeason}-${p?.finalSeason}] AA: ${aa.map((x) => `${x.season}/${x.club ?? '-'}`).join(' ') || 'none'}`;
    };

    // AA cells.
    const isAA = (id: string) => id.startsWith('allAus');
    type Finding = { board: number; cell: string; aaId: string; other: string; kind: 'gridley-only' | 'afldb-only'; player: string; lacking: string; classification: string };
    const findings: Finding[] = [];
    const cellCounts: { board: number; cell: string; aaId: string; other: string; gridley: number; afldb: number; bridgedG: number }[] = [];
    let bridgeGap = 0;
    for (const cell of cells) {
      if (!isAA(cell.row) && !isAA(cell.col)) continue;
      const aaId = isAA(cell.row) ? cell.row : cell.col; const other = isAA(cell.row) ? cell.col : cell.row;
      const boardYear = Number(boards.find((b) => b.board === cell.board)!.date.slice(0, 4));
      const aSet = new Set(cell.a); const gSet = new Set(cell.g);
      const aaSet = sets.get(aaId)!; const otherSet = mappings.get(other)!.status === 'freebie' ? null : sets.get(other)!;
      let bridged = 0;
      for (const g of cell.g) {
        const id = B.get(g);
        if (id === undefined) { bridgeGap++; continue; }
        bridged++;
        if (aSet.has(id)) continue;
        const lackAA = !aaSet.has(id); const lackOther = otherSet ? !otherSet.has(id) : false;
        const p = playerById.get(id);
        const active = p?.finalSeason === null || (p?.finalSeason ?? 0) >= boardYear;
        const cls = !lackAA ? 'other axis (not All-Australian)' : active ? 'board-time effect' : 'AFLDB source missing required selection';
        findings.push({ board: cell.board, cell: `${cell.r}-${cell.c}`, aaId, other, kind: 'gridley-only', player: desc(id), lacking: `${lackAA ? aaId : ''}${lackAA && lackOther ? '+' : ''}${lackOther ? other : ''}`, classification: cls });
      }
      for (const id of cell.a) {
        const g = inv.get(id);
        if (g === undefined || gSet.has(g)) continue;
        const p = playerById.get(id);
        const active = p?.finalSeason === null || (p?.finalSeason ?? 0) >= boardYear;
        findings.push({ board: cell.board, cell: `${cell.r}-${cell.c}`, aaId, other, kind: 'afldb-only', player: desc(id), lacking: '', classification: active ? 'board-time effect' : 'AFLDB source has extra non-Gridley selection (or other-axis list membership)' });
      }
      cellCounts.push({ board: cell.board, cell: `${cell.r}-${cell.c}`, aaId, other, gridley: cell.g.length, afldb: cell.a.length, bridgedG: bridged });
    }

    // Per-player summary of AA-family disagreements (retired players only).
    const byPlayer = new Map<string, { kind: string; cells: number; ids: Set<string> }>();
    for (const f of findings) {
      if (f.classification === 'board-time effect' || f.classification.startsWith('other axis')) continue;
      const k = `${f.kind}|${f.player}`;
      const e = byPlayer.get(k) ?? { kind: f.kind, cells: 0, ids: new Set() };
      e.cells++; e.ids.add(`${f.aaId}${f.lacking ? `(${f.lacking})` : ''}`); byPlayer.set(k, e);
    }
    // 1984 duals and the 1983/86/88 players: how does Gridley treat them?
    const seasonPlayers = (s: number) => [...aaByPlayer.entries()].filter(([, rows]) => rows.some((r) => r.season === s)).map(([id]) => id);
    const treat = (id: number) => {
      const g = inv.get(id); if (g === undefined) return 'unbridged';
      let inCells = 0, listed = 0, listed2x = 0, in2x = 0;
      for (const cell of cells) {
        const aaId = isAA(cell.row) ? cell.row : isAA(cell.col) ? cell.col : null; if (!aaId) continue;
        const other = aaId === cell.row ? cell.col : cell.row;
        const otherSet = mappings.get(other)!.status === 'freebie' ? null : sets.get(other)!;
        if (otherSet && !otherSet.has(id)) continue;
        if (aaId === 'allAus1953') { inCells++; if (cell.g.includes(g)) listed++; }
        if (aaId === 'allAus2x') { in2x++; if (cell.g.includes(g)) listed2x++; }
      }
      return `1x cells ${inCells} listed ${listed}; 2x cells ${in2x} listed ${listed2x}`;
    };
    const historical: Record<string, string[]> = {};
    for (const s of [1983, 1984, 1986, 1988]) historical[String(s)] = seasonPlayers(s).map((id) => `${desc(id)} => ${treat(id)}`);
    const report = {
      criterionSets: sets.size, cellsUsable: cells.length, fingerprintBridge: bridge.size, nameBridge: nameBridge.size, unionBridge: B.size, agree, disagree, disagreements,
      aaCells: cellCounts.length, bridgeGapAnswerEntries: bridgeGap,
      findingsByClass: Object.fromEntries([...new Set(findings.map((f) => f.classification))].map((c) => [c, findings.filter((f) => f.classification === c).length])),
      perPlayer: [...byPlayer.entries()].map(([k, e]) => ({ key: k, cells: e.cells, ids: [...e.ids] })).sort((a, b) => b.cells - a.cells),
      historical, cellCounts, findings,
    };
    writeFileSync(OUT!, JSON.stringify(report, null, 1));
    console.log(`[aa-oracle] report ${OUT}; findings ${JSON.stringify(report.findingsByClass)}; per-player AA disagreements ${byPlayer.size}`);
    expect(cells.length).toBeGreaterThan(0);
  }, 1_800_000);
});
