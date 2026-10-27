import Link from 'next/link';
import { Fragment } from 'react';

import type { AflApiFindingCounts, AflApiFindingRow, AflApiFindingsPage } from '@/db/queries/afl-api-settle-findings';

import { AFL_API_FINDING_SECTION_LABELS, aflApiFindingsHref, formatInstant } from '../views';

/**
 * The sections of `/admin/operations/afl-api-refusals` (V2-GAP-025). Props in, markup out: no hooks,
 * no data access, so each is rendered by the tests from SYNTHETIC props. READ-ONLY: no form, no
 * button, no retry; a finding is closed only by the settle that owns it.
 */

const SECTIONS = ['refusals', 'findings'] as const;

const severityBadge = (severity: string): string => (
  severity === 'error' ? 'badge badge-danger' : severity === 'warning' ? 'badge badge-warn' : 'badge'
);

function countWords(counts: AflApiFindingCounts): string {
  if (counts.total === 0) return 'none open';
  const parts = ['error', 'warning', 'info']
    .filter((severity) => (counts.bySeverity[severity] ?? 0) > 0)
    .map((severity) => `${counts.bySeverity[severity]} ${severity}`);
  return `${counts.total} open (${parts.join(', ')})`;
}

/** The two sections with their open counts; the active one is not a link. */
export function AflApiFindingsNav({ page }: { page: AflApiFindingsPage }) {
  return (
    <nav aria-label="AFL API settle refusals and findings">
      <p>
        {SECTIONS.map((section, index) => {
          const label = `${AFL_API_FINDING_SECTION_LABELS[section]}: ${countWords(page.counts[section])}`;
          return (
            <Fragment key={section}>
              {index > 0 && ' · '}
              {section === page.section
                ? <strong aria-current="page" data-findings-section={section}>{label}</strong>
                : <Link href={aflApiFindingsHref(section)}>{label}</Link>}
            </Fragment>
          );
        })}
      </p>
    </nav>
  );
}

const dash = <span className="muted">—</span>;

const EMPTY_TEXT = {
  refusals: 'No refused canonical application is open for the AFL API settles.',
  findings: 'No AFL API settle finding is open.',
} as const;

function FieldNames({ row }: { row: AflApiFindingRow }) {
  if (row.fields.length === 0) return dash;
  return (
    <span className="mono">
      {row.fields.join(', ')}
      {row.fieldsOmitted > 0 && <span className="muted"> and {row.fieldsOmitted} more</span>}
    </span>
  );
}

/** One page of findings, newest first. */
export function AflApiFindingsTable({ page }: { page: AflApiFindingsPage }) {
  if (page.rows.length === 0) {
    return (
      <p className="empty" data-findings-empty="true">
        {page.before === null ? EMPTY_TEXT[page.section] : 'No older entries.'}
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">{AFL_API_FINDING_SECTION_LABELS[page.section]}, newest first</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Id</th>
            <th scope="col">Severity</th>
            <th scope="col">First detected</th>
            <th scope="col">Type</th>
            <th scope="col">Record</th>
            <th scope="col">Target</th>
            <th scope="col">Refusal or reason</th>
            <th scope="col">Fields</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.id} data-finding-id={row.id}>
              <td className="num mono">{row.id}</td>
              <td><span className={severityBadge(row.severity)}>{row.severity}</span></td>
              <td className="nowrap">{formatInstant(row.detectedAt)}</td>
              <td className="mono">{row.issueType}</td>
              <td>
                {row.family === null && row.externalRecordId === null
                  ? dash
                  : <span className="mono">{[row.family, row.externalRecordId].filter((part) => part !== null).join(' ')}</span>}
                {row.matchKey !== null && row.matchKey !== row.externalRecordId && (
                  <><br /><span className="muted">match <span className="mono">{row.matchKey}</span></span></>
                )}
              </td>
              <td className="mono">{row.targetTable ?? row.entityType}</td>
              <td>{row.reason === null ? dash : <span className="mono">{row.reason}</span>}</td>
              <td><FieldNames row={row} /></td>
              <td>
                {row.description}
                {row.descriptionTruncated && <span className="muted"> (shortened)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Newest-page and older-page links; bounded keyset paging, so a page never repeats or skips a row. */
export function AflApiFindingsPager({ page }: { page: AflApiFindingsPage }) {
  if (page.before === null && page.nextBefore === null) return null;
  return (
    <nav aria-label="Pages">
      <p>
        {page.before !== null && <Link href={aflApiFindingsHref(page.section)}>← Newest</Link>}
        {page.before !== null && page.nextBefore !== null && ' · '}
        {page.nextBefore !== null && (
          <Link href={aflApiFindingsHref(page.section, page.nextBefore)} data-findings-next={page.nextBefore}>
            Older →
          </Link>
        )}
        <span className="muted"> ({page.pageSize} per page, newest first)</span>
      </p>
    </nav>
  );
}
