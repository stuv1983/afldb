/**
 * ISSUE-118 §23.12: All-Australian answer-key comparison against the test
 * database, using Gridley's stored per-cell answer keys as the external
 * oracle. Opt-in (set AFLDB_AA_REPORT=<file>): it computes every criterion
 * set, so it costs about a minute and is a diagnostic, not a gate. The
 * 2026-09-05 run and its conclusions are in issues/closed/AFLDB-ISSUE-118.md.
 *
 * The criterion sets, cells and the name + co-occurrence fingerprint bridge
 * from Gridley ids to AFLDB players come from ./gridley-oracle-bridge.ts,
 * shared with the height oracle.
 */
import './guard';

import { writeFileSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { buildGridleyOracle } from './gridley-oracle-bridge';

afterAll(async () => { await sql.end(); });

const OUT = process.env.AFLDB_AA_REPORT;

type AaRow = { playerId: number; season: number; club: string | null; key: string };

describe('ISSUE-118 All-Australian oracle', () => {
  it.skipIf(!OUT)('compares AFLDB against Gridley answer keys', async () => {
    const aaRows = await sql<AaRow[]>`SELECT w.player_id AS "playerId", w.season::int AS season, w.club_name_raw AS club, w.source_record_id AS key
                     FROM award_winners w JOIN awards a ON a.id = w.award_id
                    WHERE a.slug = 'all-australian' AND w.player_id IS NOT NULL AND w.link_status_value IN ('unique', 'resolved')`;
    const { boards, playerById, mappings, sets, cells, bridge, inverse, nameBridge, fingerprint, agree, disagree, disagreements } = await buildGridleyOracle('aa-oracle');

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
        const id = bridge.get(g);
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
        const g = inverse.get(id);
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
      const g = inverse.get(id); if (g === undefined) return 'unbridged';
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
      criterionSets: sets.size, cellsUsable: cells.length, fingerprintBridge: fingerprint.size, nameBridge: nameBridge.size, unionBridge: bridge.size, agree, disagree, disagreements,
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
