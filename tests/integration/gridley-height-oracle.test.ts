/**
 * ISSUE-118 §23.16 (Stage H2): the height family measured against Gridley's
 * stored answer keys. Opt-in (set AFLDB_HEIGHT_REPORT=<file>): it computes
 * every criterion set through the shared oracle scaffold, so it costs about a
 * minute and is a diagnostic, not a gate.
 *
 * Two questions, reported separately:
 *
 *   1. Coverage (H2.2). Of the distinct Gridley players in the answer keys of
 *      every height cell, how many bridge to an AFLDB player, and how many of
 *      those have a height? With AFLDB_HEIGHT_PLANNED=<enrich_heights.py
 *      --report file>, the planned fills are counted too, so the measurement
 *      can be taken BEFORE the data is applied.
 *   2. Answer-key comparison. On every usable height cell, bridged Gridley
 *      answers AFLDB does not list (false negatives) and AFLDB answers with a
 *      bridged Gridley id that the key does not list (false positives), each
 *      classified so a data gap is never mistaken for a builder fault.
 */
import './guard';

import { readFileSync, writeFileSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { loadAnswers } from '../gridley-compat.test';
import { buildGridleyOracle } from './gridley-oracle-bridge';

afterAll(async () => { await sql.end(); });

const OUT = process.env.AFLDB_HEIGHT_REPORT;
const PLANNED = process.env.AFLDB_HEIGHT_PLANNED;

describe('ISSUE-118 height oracle', () => {
  it.skipIf(!OUT)('measures coverage and compares AFLDB against Gridley answer keys', async () => {
    const o = await buildGridleyOracle('height-oracle');
    const answers = loadAnswers();
    const heightRows = await sql<{ id: number; height: number }[]>`SELECT id, height_cm AS height FROM players WHERE height_cm IS NOT NULL`;
    const height = new Map(heightRows.map((r) => [r.id, r.height]));
    const planned = new Map<number, number>();
    if (PLANNED) {
      const rep = JSON.parse(readFileSync(PLANNED, 'utf8')) as { fills?: [number, number][] };
      for (const [id, h] of rep.fills ?? []) planned.set(id, h);
    }
    const isHeight = (id: string) => {
      const m = o.mappings.get(id);
      return m?.status === 'mapped' && m.axis.builder.startsWith('height_');
    };
    const bound = (id: string) => {
      const m = o.mappings.get(id);
      return m?.status === 'mapped' ? `${m.axis.builder}(${m.axis.params.cm})` : id;
    };
    const desc = (id: number) => {
      const p = o.playerById.get(id);
      return `${id} ${p?.displayName} [${p?.debutSeason}-${p?.finalSeason}]`;
    };

    // 1. Coverage over EVERY height cell's answer key, usable or not.
    const heightIds = new Set<string>();
    const keyPlayers = new Set<number>();
    let heightCells = 0;
    for (const b of o.boards) {
      const key = answers[String(b.board)];
      b.rows.forEach((ri, r) => b.cols.forEach((ci, c) => {
        if (!isHeight(ri.id) && !isHeight(ci.id)) return;
        heightCells++;
        heightIds.add(isHeight(ri.id) ? ri.id : ci.id);
        for (const g of key[r][c]) keyPlayers.add(g);
      }));
    }
    const missing: string[] = [];
    let bridged = 0, withHeight = 0, plannedOnly = 0;
    for (const g of keyPlayers) {
      const id = o.bridge.get(g);
      if (id === undefined) continue;
      bridged++;
      if (height.has(id)) withHeight++;
      else if (planned.has(id)) plannedOnly++;
      else missing.push(desc(id));
    }
    missing.sort();
    const coverage = {
      heightCriteria: [...heightIds].sort(), heightCells,
      distinctGridleyAnswerPlayers: keyPlayers.size, bridged,
      bridgedWithHeight: withHeight, bridgedPlannedFill: plannedOnly,
      bridgedMissingHeight: missing.length, missing,
    };
    o.log(`coverage ${JSON.stringify({ ...coverage, missing: undefined })}`);

    // 2. Answer-key comparison on the usable height cells.
    type Finding = { board: number; cell: string; heightId: string; other: string; kind: 'false-negative' | 'false-positive'; player: string; afldbHeight: number | null; classification: string };
    const findings: Finding[] = [];
    let unbridged = 0, compared = 0;
    for (const cell of o.cells) {
      if (!isHeight(cell.row) && !isHeight(cell.col)) continue;
      compared++;
      const heightId = isHeight(cell.row) ? cell.row : cell.col; const other = heightId === cell.row ? cell.col : cell.row;
      const boardYear = Number(o.boards.find((b) => b.board === cell.board)!.date.slice(0, 4));
      const aSet = new Set(cell.a); const gSet = new Set(cell.g);
      const hSet = o.sets.get(heightId)!;
      const otherM = o.mappings.get(other)!;
      const otherSet = otherM.status === 'freebie' ? null : o.sets.get(other)!;
      for (const g of cell.g) {
        const id = o.bridge.get(g);
        if (id === undefined) { unbridged++; continue; }
        if (aSet.has(id)) continue;
        const h = height.get(id) ?? null;
        const lacksHeight = !hSet.has(id); const lacksOther = otherSet ? !otherSet.has(id) : false;
        const cls = !lacksHeight ? 'other axis (height satisfied)'
          : h === null ? 'no height in AFLDB'
            : 'AFLDB height fails the bound';
        findings.push({ board: cell.board, cell: `${cell.r}-${cell.c}`, heightId, other, kind: 'false-negative', player: desc(id), afldbHeight: h, classification: `${cls}${lacksOther ? ' + other axis' : ''}` });
      }
      for (const id of cell.a) {
        const g = o.inverse.get(id);
        if (g === undefined || gSet.has(g)) continue;
        const p = o.playerById.get(id);
        const active = p?.finalSeason === null || (p?.finalSeason ?? 0) >= boardYear;
        findings.push({ board: cell.board, cell: `${cell.r}-${cell.c}`, heightId, other, kind: 'false-positive', player: desc(id), afldbHeight: height.get(id) ?? null, classification: active ? 'board-time effect' : 'AFLDB lists a bridged player Gridley omits' });
      }
    }
    const byClass = (kind: Finding['kind']) => Object.fromEntries(
      [...new Set(findings.filter((f) => f.kind === kind).map((f) => f.classification))]
        .map((c) => [c, findings.filter((f) => f.kind === kind && f.classification === c).length]));
    const report = {
      criterionSets: o.sets.size, cellsUsable: o.cells.length, heightCellsCompared: compared,
      fingerprintBridge: o.fingerprint.size, nameBridge: o.nameBridge.size, unionBridge: o.bridge.size,
      bridgeAgree: o.agree, bridgeDisagree: o.disagree,
      bounds: Object.fromEntries([...heightIds].map((id) => [id, bound(id)])),
      coverage, unbridgedAnswerEntries: unbridged,
      falseNegatives: findings.filter((f) => f.kind === 'false-negative').length,
      falseNegativesByClass: byClass('false-negative'),
      falsePositives: findings.filter((f) => f.kind === 'false-positive').length,
      falsePositivesByClass: byClass('false-positive'),
      findings,
    };
    writeFileSync(OUT!, JSON.stringify(report, null, 1));
    o.log(`report ${OUT}; FN ${JSON.stringify(report.falseNegativesByClass)}; FP ${JSON.stringify(report.falsePositivesByClass)}`);
    expect(heightCells).toBeGreaterThan(0);
  }, 1_800_000);
});
