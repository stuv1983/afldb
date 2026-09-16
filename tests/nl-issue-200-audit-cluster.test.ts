/**
 * AFLDB-ISSUE-200 clustering/disposition tooling.
 *
 * DB-free: builds a synthetic 1,063-row audit CSV in memory (real input is
 * audit-issue-200-extract.ts's output against the external DEV artifact,
 * which this repository does not carry), shaped with the exact 72/921/70
 * class split spread across a handful of auto_cluster_key values, then
 * proves buildClusters' and applyDispositions' invariants: exact count
 * reconciliation, cross-class key collision rejection, unmapped/stale/
 * invalid disposition rejection, and the final per-row accounting.
 */
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';
import {
  AUDIT_COLUMNS, DISPOSITIONS, EXPECTED_TOTAL, type AuditRow, type TargetClass,
} from '../tools/nl/audit-issue-200-shared';
import {
  applyDispositions, buildClusterMarkdown, buildClusters, readAuditCsv, readDispositionMapping,
  type DispositionMappingRow,
} from '../tools/nl/audit-issue-200-cluster';

// ------------------------------------------------------------------ fixtures

function blankRow(): AuditRow {
  return Object.fromEntries(AUDIT_COLUMNS.map((c) => [c, ''])) as AuditRow;
}

function makeRow(overrides: Partial<AuditRow>): AuditRow {
  return { ...blankRow(), ...overrides };
}

/** auto_cluster_key -> row count, spread across the three classes, summing to exactly 72/921/70. */
const GRAIN_CLUSTERS: [string, number][] = [
  ['player_season->player_game/sum', 40],
  ['player_career->player_game/single', 20],
  ['team_season->team_match/sum', 12],
];
const DECLINE_CLUSTERS: [string, number][] = [
  ['unsupported_term|tm|coach', 500],
  ['ambiguous_player|h2h', 300],
  ['unrecognised|career', 121],
];
const REASON_CLUSTERS: [string, number][] = [
  ['ambiguous_player->low_confidence', 50],
  ['unsupported_term->unrecognised', 20],
];

function buildBaselineAuditRows(): AuditRow[] {
  const rows: AuditRow[] = [];
  let id = 1;
  const groups: [TargetClass, [string, number][]][] = [
    ['GRAIN_EQUIVALENT', GRAIN_CLUSTERS],
    ['UNEXPECTED_DECLINE', DECLINE_CLUSTERS],
    ['WRONG_FAILURE_REASON', REASON_CLUSTERS],
  ];
  for (const [cls, clusters] of groups) {
    for (const [key, count] of clusters) {
      for (let i = 0; i < count; i++) {
        rows.push(makeRow({ id: String(id), class: cls, question: `Question ${id}`, auto_cluster_key: key }));
        id++;
      }
    }
  }
  return rows;
}

function buildFullMapping(): DispositionMappingRow[] {
  return [
    { auto_cluster_key: 'player_season->player_game/sum', cluster_name: 'season-vs-game-sum', disposition: 'GRAIN_EQUIVALENT_LEGITIMATE', follow_on_issue: '', rationale: 'r1' },
    { auto_cluster_key: 'player_career->player_game/single', cluster_name: 'career-vs-game-single', disposition: 'GRAIN_EQUIVALENT_LEGITIMATE', follow_on_issue: '', rationale: 'r2' },
    { auto_cluster_key: 'team_season->team_match/sum', cluster_name: 'team-season-vs-match', disposition: 'GRAIN_EQUIVALENT_LEGITIMATE', follow_on_issue: '', rationale: 'r3' },
    { auto_cluster_key: 'unsupported_term|tm|coach', cluster_name: 'coach-unsupported', disposition: 'INTENTIONAL_CONSERVATIVE_DECLINE', follow_on_issue: '', rationale: 'r4' },
    { auto_cluster_key: 'ambiguous_player|h2h', cluster_name: 'h2h-ambiguous', disposition: 'PARSER_BUG', follow_on_issue: 'AFLDB-ISSUE-9001', rationale: 'r5' },
    { auto_cluster_key: 'unrecognised|career', cluster_name: 'career-unrecognised', disposition: 'STALE_CORPUS_EXPECTATION', follow_on_issue: '', rationale: 'r6' },
    { auto_cluster_key: 'ambiguous_player->low_confidence', cluster_name: 'ambiguous-to-low-confidence', disposition: 'TAXONOMY_DRIFT', follow_on_issue: '', rationale: 'r7' },
    { auto_cluster_key: 'unsupported_term->unrecognised', cluster_name: 'term-to-unrecognised', disposition: 'TAXONOMY_DRIFT', follow_on_issue: '', rationale: 'r8' },
  ];
}

// --------------------------------------------------------------------- tests

describe('buildClusters', () => {
  it('groups exactly 1063 rows into the 8 designed clusters, reconciling per-class and total counts', () => {
    const clusters = buildClusters(buildBaselineAuditRows());
    expect(clusters).toHaveLength(8);
    expect(clusters.reduce((sum, c) => sum + c.rowCount, 0)).toBe(EXPECTED_TOTAL);

    const byKey = new Map(clusters.map((c) => [c.key, c]));
    expect(byKey.get('unsupported_term|tm|coach')?.rowCount).toBe(500);
    expect(byKey.get('unsupported_term|tm|coach')?.class).toBe('UNEXPECTED_DECLINE');
    expect(byKey.get('team_season->team_match/sum')?.rowCount).toBe(12);
    expect(byKey.get('team_season->team_match/sum')?.class).toBe('GRAIN_EQUIVALENT');

    // largest cluster sorts first
    expect(clusters[0].key).toBe('unsupported_term|tm|coach');
    expect(clusters[0].exampleIds).toHaveLength(5);
  });

  it('rejects a total that is not exactly 1063', () => {
    const rows = buildBaselineAuditRows();
    rows.pop();
    expect(() => buildClusters(rows)).toThrow(/Expected exactly 1063 audit rows, found 1062/);
  });

  it('rejects a per-class count that does not match the parser-v50 baseline', () => {
    // Total stays exactly 1063 (buildClusters checks total before per-class counts, and a wrong
    // total would mask this test's intent -- see the total-count test above). Instead, relabels one
    // 'team_season->team_match/sum' GRAIN_EQUIVALENT row (id 61) as an UNEXPECTED_DECLINE row joining
    // the existing 'ambiguous_player|h2h' cluster: GRAIN_EQUIVALENT drops to 71, UNEXPECTED_DECLINE
    // rises to 922, total is unchanged.
    const rows = buildBaselineAuditRows().map((row) => (
      row.id === '61' ? { ...row, class: 'UNEXPECTED_DECLINE', auto_cluster_key: 'ambiguous_player|h2h' } : row
    ));
    expect(rows).toHaveLength(EXPECTED_TOTAL);
    expect(() => buildClusters(rows)).toThrow(/Expected exactly 72 GRAIN_EQUIVALENT rows in the audit CSV, found 71/);
  });

  it('rejects an auto_cluster_key shared by rows of more than one finding class', () => {
    const rows = buildBaselineAuditRows().map((row) => (
      row.id === '73' ? { ...row, auto_cluster_key: 'player_season->player_game/sum' } : row
    ));
    expect(() => buildClusters(rows)).toThrow(/shared by more than one finding class/);
  });

  it('rejects an audit row with an unrecognised class value', () => {
    const rows = buildBaselineAuditRows().map((row) => (row.id === '1' ? { ...row, class: 'NOT_A_CLASS' } : row));
    expect(() => buildClusters(rows)).toThrow(/unrecognised class "NOT_A_CLASS"/);
  });
});

describe('buildClusterMarkdown', () => {
  it('renders one section per cluster with its class, key and row count', () => {
    const markdown = buildClusterMarkdown(buildClusters(buildBaselineAuditRows()));
    expect(markdown).toContain('8 auto-clusters across 1063 soft rows');
    expect(markdown).toContain('UNEXPECTED_DECLINE -- `unsupported_term|tm|coach` (500 rows)');
    expect(markdown).toContain('GRAIN_EQUIVALENT -- `team_season->team_match/sum` (12 rows)');
  });
});

describe('applyDispositions', () => {
  it('joins a complete mapping onto all 1063 rows with the exact per-disposition accounting', () => {
    const auditRows = buildBaselineAuditRows();
    const clusters = buildClusters(auditRows);
    const finalRows = applyDispositions(auditRows, clusters, buildFullMapping());

    expect(finalRows).toHaveLength(EXPECTED_TOTAL);
    expect(finalRows.every((r) => r.provisional_disposition !== '')).toBe(true);
    expect(finalRows.every((r) => DISPOSITIONS.includes(r.provisional_disposition as (typeof DISPOSITIONS)[number]))).toBe(true);

    const countsByDisposition = new Map<string, number>();
    for (const row of finalRows) {
      countsByDisposition.set(row.provisional_disposition, (countsByDisposition.get(row.provisional_disposition) ?? 0) + 1);
    }
    expect(countsByDisposition.get('GRAIN_EQUIVALENT_LEGITIMATE')).toBe(40 + 20 + 12);
    expect(countsByDisposition.get('INTENTIONAL_CONSERVATIVE_DECLINE')).toBe(500);
    expect(countsByDisposition.get('PARSER_BUG')).toBe(300);
    expect(countsByDisposition.get('STALE_CORPUS_EXPECTATION')).toBe(121);
    expect(countsByDisposition.get('TAXONOMY_DRIFT')).toBe(50 + 20);
    expect([...countsByDisposition.values()].reduce((a, b) => a + b, 0)).toBe(EXPECTED_TOTAL);

    const followOnRow = finalRows.find((r) => r.auto_cluster_key === 'ambiguous_player|h2h')!;
    expect(followOnRow.cluster).toBe('h2h-ambiguous');
  });

  it('refuses to finish when a cluster has no disposition-mapping entry', () => {
    const auditRows = buildBaselineAuditRows();
    const clusters = buildClusters(auditRows);
    const mapping = buildFullMapping().filter((m) => m.auto_cluster_key !== 'ambiguous_player|h2h');
    expect(() => applyDispositions(auditRows, clusters, mapping)).toThrow(/no disposition-mapping entry.*ambiguous_player\|h2h/s);
  });

  it('refuses an unrecognised disposition value', () => {
    const auditRows = buildBaselineAuditRows();
    const clusters = buildClusters(auditRows);
    const mapping = buildFullMapping().map((m) => (
      m.auto_cluster_key === 'ambiguous_player|h2h' ? { ...m, disposition: 'MAYBE_A_BUG' } : m
    ));
    expect(() => applyDispositions(auditRows, clusters, mapping)).toThrow(/unrecognised disposition value.*MAYBE_A_BUG/s);
  });

  it('refuses a mapping entry whose auto_cluster_key does not correspond to a current cluster', () => {
    const auditRows = buildBaselineAuditRows();
    const clusters = buildClusters(auditRows);
    const mapping = [
      ...buildFullMapping(),
      { auto_cluster_key: 'this_key_does_not_exist', cluster_name: 'stale', disposition: 'PARSER_BUG', follow_on_issue: '', rationale: 'stale entry' },
    ];
    expect(() => applyDispositions(auditRows, clusters, mapping)).toThrow(/do not correspond to a current cluster.*this_key_does_not_exist/s);
  });

  it('refuses a mapping with a duplicate auto_cluster_key', () => {
    const auditRows = buildBaselineAuditRows();
    const clusters = buildClusters(auditRows);
    const mapping = [...buildFullMapping(), { ...buildFullMapping()[0] }];
    expect(() => applyDispositions(auditRows, clusters, mapping)).toThrow(/duplicate auto_cluster_key value\(s\)/);
  });
});

describe('CSV round-trip (readAuditCsv / readDispositionMapping)', () => {
  it('preserves a question containing a comma, a quote and a newline', () => {
    const tricky = 'Who scored, "the most" goals?\nSecond line';
    const row = makeRow({ id: '1', class: 'GRAIN_EQUIVALENT', question: tricky, auto_cluster_key: 'k' });
    const csvText = toCsv(AUDIT_COLUMNS, [row]);
    const readBack = readAuditCsv(csvText);
    expect(readBack).toHaveLength(1);
    expect(readBack[0].question).toBe(tricky);
  });

  it('reads a disposition mapping CSV with an escaped rationale field back intact', () => {
    const rationale = 'Confirmed via docs/search/nl.md, section "grain equivalence, revisited"';
    const csvText = toCsv(
      ['auto_cluster_key', 'cluster_name', 'disposition', 'follow_on_issue', 'rationale'],
      [{ auto_cluster_key: 'k', cluster_name: 'n', disposition: 'PARSER_BUG', follow_on_issue: '', rationale }],
    );
    const mapping = readDispositionMapping(csvText);
    expect(mapping).toHaveLength(1);
    expect(mapping[0].rationale).toBe(rationale);
  });

  it('rejects an audit CSV missing a required column', () => {
    const columns = AUDIT_COLUMNS.filter((c) => c !== 'auto_cluster_key');
    const csvText = `${columns.join(',')}\r\n${columns.map(() => '').join(',')}\r\n`;
    expect(() => readAuditCsv(csvText)).toThrow(/missing required column "auto_cluster_key"/);
  });
});
