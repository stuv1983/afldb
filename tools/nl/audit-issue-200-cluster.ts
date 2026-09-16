#!/usr/bin/env tsx
/**
 * AFLDB-ISSUE-200 -- groups the audit-issue-200-extract.ts output CSV into
 * auto-clusters for a human/agent to read and disposition, then (once every
 * cluster has a disposition recorded in a small checked-in mapping file)
 * joins that mapping back onto all 1,063 rows and writes the final
 * classified audit CSV.
 *
 * Cluster summary pass (always run):
 *   npx tsx tools/nl/audit-issue-200-cluster.ts \
 *     --audit /home/arm/issue-200-soft-audit.csv \
 *     --out-summary /home/arm/issue-200-clusters.md
 *
 * Disposition pass (once issue-200-dispositions.csv exists and covers every
 * cluster printed above):
 *   npx tsx tools/nl/audit-issue-200-cluster.ts \
 *     --audit /home/arm/issue-200-soft-audit.csv \
 *     --apply-dispositions issue-200-dispositions.csv \
 *     --out-final /home/arm/issue-200-soft-audit-final.csv
 *
 * The dispositions mapping is a small CSV with columns
 * `auto_cluster_key, cluster_name, disposition, follow_on_issue, rationale`
 * -- one row per cluster, not per finding. `disposition` must be one of the
 * eight AFLDB-ISSUE-200.md S5 values (audit-issue-200-shared.ts's
 * DISPOSITIONS). This script never assigns a disposition itself.
 *
 * FAILS CLOSED:
 *   - the audit CSV's per-class row counts must exactly match the
 *     parser-v50 baseline (72 / 921 / 70 / 1063);
 *   - an auto_cluster_key shared by rows of more than one finding class
 *     aborts rather than silently merging two different clusters;
 *   - --apply-dispositions refuses to finish if any current cluster has no
 *     mapping entry, if any mapping entry's auto_cluster_key does not match
 *     a current cluster (a stale entry from a previous audit CSV), or if
 *     any mapping entry's disposition is not one of the eight closed
 *     values.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import {
  AUDIT_COLUMNS, DISPOSITIONS, EXPECTED_CLASS_COUNTS, EXPECTED_TOTAL, isDisposition, isTargetClass,
  TARGET_CLASSES, type AuditRow, type TargetClass,
} from './audit-issue-200-shared';
import { parseCsv } from './corpus';
import { option } from './engine';

// -------------------------------------------------------------- audit CSV

/** Reads back a CSV produced by audit-issue-200-extract.ts. */
export function readAuditCsv(text: string): AuditRow[] {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return [];
  const header = parsed[0];
  for (const column of AUDIT_COLUMNS) {
    if (!header.includes(column)) throw new Error(`Audit CSV is missing required column "${column}".`);
  }
  return parsed.slice(1)
    .filter((cells) => cells.some((cell) => cell !== ''))
    .map((cells) => {
      const record = {} as Record<string, string>;
      header.forEach((name, index) => { record[name] = cells[index] ?? ''; });
      return record as AuditRow;
    });
}

// ----------------------------------------------------------------- cluster

export type ClusterSummary = {
  key: string;
  class: TargetClass;
  rowCount: number;
  exampleIds: string[];
  exampleQuestions: string[];
  expectedShape: string;
  actualShape: string;
};

function summariseExpected(row: AuditRow): string {
  switch (row.class) {
    case 'GRAIN_EQUIVALENT':
      return `grain=${row.expected_grain || '(none)'} mode=${row.expected_mode || '(none)'} metric=${row.expected_metric || '(none)'}`;
    case 'WRONG_FAILURE_REASON':
      return `status=decline reason=${row.expected_failure_reason || '(none)'}`;
    default:
      return `status=success grain=${row.expected_grain || '(none)'} metric=${row.expected_metric || '(none)'} aggregation=${row.expected_aggregation || '(none)'}`;
  }
}

function summariseActual(row: AuditRow): string {
  switch (row.class) {
    case 'GRAIN_EQUIVALENT':
      return `grain=${row.actual_grain || '(none)'} mode=${row.actual_mode || '(none)'}`;
    case 'WRONG_FAILURE_REASON':
      return `status=decline reason=${row.actual_failure_reason || '(none)'}`;
    default:
      return `status=decline reason=${row.actual_failure_reason || '(none)'}${row.actual_unsupported_terms ? ` terms=${row.actual_unsupported_terms}` : ''}`;
  }
}

/**
 * Groups by auto_cluster_key, verifying every count reconciles back to the
 * parser-v50 baseline. Exported for tests/nl-issue-200-audit-cluster.test.ts.
 */
export function buildClusters(rows: readonly AuditRow[]): ClusterSummary[] {
  if (rows.length !== EXPECTED_TOTAL) {
    throw new Error(`Expected exactly ${EXPECTED_TOTAL} audit rows, found ${rows.length}.`);
  }

  const byClassCount: Record<TargetClass, number> = { GRAIN_EQUIVALENT: 0, UNEXPECTED_DECLINE: 0, WRONG_FAILURE_REASON: 0 };
  for (const row of rows) {
    if (!isTargetClass(row.class)) throw new Error(`Audit row id ${row.id} has unrecognised class "${row.class}".`);
    byClassCount[row.class]++;
  }
  for (const cls of TARGET_CLASSES) {
    if (byClassCount[cls] !== EXPECTED_CLASS_COUNTS[cls]) {
      throw new Error(`Expected exactly ${EXPECTED_CLASS_COUNTS[cls]} ${cls} rows in the audit CSV, found ${byClassCount[cls]}.`);
    }
  }

  const groups = new Map<string, AuditRow[]>();
  for (const row of rows) {
    if (!groups.has(row.auto_cluster_key)) groups.set(row.auto_cluster_key, []);
    groups.get(row.auto_cluster_key)!.push(row);
  }

  const clusters: ClusterSummary[] = [];
  for (const [key, members] of groups) {
    const classes = new Set(members.map((m) => m.class));
    if (classes.size > 1) {
      throw new Error(
        `auto_cluster_key "${key}" is shared by more than one finding class (${[...classes].join(', ')}) -- `
        + 'refusing to merge clusters across classes.',
      );
    }
    clusters.push({
      key,
      class: members[0].class as TargetClass,
      rowCount: members.length,
      exampleIds: members.slice(0, 5).map((m) => m.id),
      exampleQuestions: members.slice(0, 5).map((m) => m.question),
      expectedShape: summariseExpected(members[0]),
      actualShape: summariseActual(members[0]),
    });
  }

  const reconciledTotal = clusters.reduce((sum, c) => sum + c.rowCount, 0);
  if (reconciledTotal !== EXPECTED_TOTAL) {
    throw new Error(`Internal error: cluster row counts sum to ${reconciledTotal}, expected ${EXPECTED_TOTAL}.`);
  }

  return clusters.sort((a, b) => b.rowCount - a.rowCount || a.key.localeCompare(b.key));
}

export function buildClusterMarkdown(clusters: readonly ClusterSummary[]): string {
  const out: string[] = [];
  out.push('# AFLDB-ISSUE-200 auto-cluster summary');
  out.push('');
  out.push(
    `${clusters.length} auto-clusters across ${EXPECTED_TOTAL} soft rows `
    + `(${EXPECTED_CLASS_COUNTS.GRAIN_EQUIVALENT} GRAIN_EQUIVALENT + ${EXPECTED_CLASS_COUNTS.UNEXPECTED_DECLINE} `
    + `UNEXPECTED_DECLINE + ${EXPECTED_CLASS_COUNTS.WRONG_FAILURE_REASON} WRONG_FAILURE_REASON).`,
  );
  out.push('');
  out.push(
    'Mechanical grouping only -- no disposition has been assigned yet. See AFLDB-ISSUE-200.md S5-S7 for the '
    + 'disposition schema and the audit gate.',
  );
  out.push('');
  for (const cluster of clusters) {
    out.push(`## ${cluster.class} -- \`${cluster.key}\` (${cluster.rowCount} rows)`);
    out.push('');
    out.push(`- Expected shape: ${cluster.expectedShape}`);
    out.push(`- Actual shape: ${cluster.actualShape}`);
    out.push('- Example rows:');
    cluster.exampleIds.forEach((id, index) => out.push(`  - id ${id}: ${cluster.exampleQuestions[index]}`));
    out.push('');
  }
  return out.join('\n');
}

// ------------------------------------------------------ disposition mapping

export type DispositionMappingRow = {
  auto_cluster_key: string;
  cluster_name: string;
  disposition: string;
  follow_on_issue: string;
  rationale: string;
};

const MAPPING_COLUMNS = ['auto_cluster_key', 'cluster_name', 'disposition', 'follow_on_issue', 'rationale'] as const;

export function readDispositionMapping(text: string): DispositionMappingRow[] {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return [];
  const header = parsed[0];
  for (const column of MAPPING_COLUMNS) {
    if (!header.includes(column)) throw new Error(`Disposition mapping is missing required column "${column}".`);
  }
  return parsed.slice(1)
    .filter((cells) => cells.some((cell) => cell !== ''))
    .map((cells) => {
      const record = {} as Record<string, string>;
      header.forEach((name, index) => { record[name] = cells[index] ?? ''; });
      return record as DispositionMappingRow;
    });
}

/**
 * Left-joins a cluster-keyed disposition mapping onto every audit row.
 * Refuses (throws, writes nothing) rather than emit a partially-classified
 * result -- see the module header for the exact fail-closed conditions.
 * Exported for tests/nl-issue-200-audit-cluster.test.ts.
 */
export function applyDispositions(
  auditRows: readonly AuditRow[],
  clusters: readonly ClusterSummary[],
  mapping: readonly DispositionMappingRow[],
): AuditRow[] {
  const duplicateKeys = mapping
    .map((m) => m.auto_cluster_key)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new Error(`Disposition mapping contains duplicate auto_cluster_key value(s): ${[...new Set(duplicateKeys)].join(', ')}.`);
  }

  const clusterKeys = new Set(clusters.map((c) => c.key));
  const mappingByKey = new Map(mapping.map((m) => [m.auto_cluster_key, m]));

  const missing = [...clusterKeys].filter((key) => !mappingByKey.has(key));
  if (missing.length > 0) {
    throw new Error(`${missing.length} cluster(s) have no disposition-mapping entry: ${missing.join(' | ')}.`);
  }

  const stale = mapping.map((m) => m.auto_cluster_key).filter((key) => !clusterKeys.has(key));
  if (stale.length > 0) {
    throw new Error(
      `Disposition mapping contains ${stale.length} auto_cluster_key value(s) that do not correspond to a `
      + `current cluster (a stale entry from a previous audit CSV?): ${stale.join(' | ')}.`,
    );
  }

  const invalid = mapping.filter((m) => !isDisposition(m.disposition));
  if (invalid.length > 0) {
    throw new Error(
      `Disposition mapping contains unrecognised disposition value(s): `
      + `${invalid.map((m) => `${m.auto_cluster_key}=${m.disposition}`).join(', ')}. `
      + `Valid values: ${DISPOSITIONS.join(', ')}.`,
    );
  }

  const finalRows = auditRows.map((row) => {
    const entry = mappingByKey.get(row.auto_cluster_key)!;
    return { ...row, cluster: entry.cluster_name, provisional_disposition: entry.disposition };
  });

  const blank = finalRows.filter((row) => row.provisional_disposition === '');
  if (blank.length > 0) {
    throw new Error(`Internal error: ${blank.length} row(s) left with a blank disposition after mapping.`);
  }
  if (finalRows.length !== EXPECTED_TOTAL) {
    throw new Error(`Internal error: final classified output has ${finalRows.length} rows, expected ${EXPECTED_TOTAL}.`);
  }

  return finalRows;
}

// ---------------------------------------------------------------------- CLI

function main(): void {
  const auditPath = option('audit');
  const outSummaryPath = option('out-summary');
  const dispositionsPath = option('apply-dispositions');
  const outFinalPath = option('out-final');
  if (!auditPath) throw new Error('--audit <path> is required.');

  const auditRows = readAuditCsv(readFileSync(auditPath, 'utf8'));
  const clusters = buildClusters(auditRows);

  if (outSummaryPath) {
    writeFileSync(outSummaryPath, buildClusterMarkdown(clusters), 'utf8');
    process.stdout.write(`${clusters.length} auto-clusters written to ${resolve(outSummaryPath)}\n`);
  } else {
    process.stdout.write(`${clusters.length} auto-clusters found (pass --out-summary to write the markdown report).\n`);
  }

  if (dispositionsPath) {
    if (!outFinalPath) throw new Error('--out-final <path> is required together with --apply-dispositions.');
    const mapping = readDispositionMapping(readFileSync(dispositionsPath, 'utf8'));
    const finalRows = applyDispositions(auditRows, clusters, mapping);
    writeFileSync(outFinalPath, toCsv(AUDIT_COLUMNS, finalRows), 'utf8');
    process.stdout.write(`Final classified audit (${finalRows.length} rows) written to ${resolve(outFinalPath)}\n`);
  }
}

// Run only when this file is the entry point. Importing buildClusters()/
// applyDispositions() -- as tests/nl-issue-200-audit-cluster.test.ts does --
// must not start a run.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
