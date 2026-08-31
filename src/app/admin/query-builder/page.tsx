import type { Metadata } from 'next';

import { QueryBuilderForm } from '@/app/admin/query-builder/QueryBuilderForm';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { Pagination } from '@/components/Pagination';
import { runQueryBuilder, type QueryBuilderResult } from '@/db/queries/query-builder';
import { requireSuperAdmin } from '@/lib/auth/session';
import { QB_LIMITS, QUERYABLE_TABLES, emptyState, parseQueryState } from '@/search/query-builder-spec';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Data QA search',
  robots: { index: false, follow: false },
};

/**
 * Hidden, super-admin-only tool for ad-hoc statistical QA -- not linked
 * from the shared admin nav (AdminLayout deliberately does no auth
 * checks; see its own comment), only from the dashboard when the signed-
 * in admin is a super admin. "Hidden" means unlinked for a plain admin,
 * never security-by-obscurity: this page enforces requireSuperAdmin()
 * itself regardless of how it was reached.
 */
export default async function QueryBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const raw = params.q;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const state = (token && parseQueryState(token)) || emptyState('players');
  // A related-domain card with no conditions is a complete question ("has /
  // has no such row"); an anchor card with no conditions filters nothing.
  // Same rule as the form's Search button.
  const hasQuery = state.cards.some((group) => group.card.conditions.length > 0 || group.card.domain !== undefined);

  let results: QueryBuilderResult | null = null;
  let error: string | null = null;
  if (hasQuery) {
    try {
      results = await runQueryBuilder(state);
    } catch (err) {
      error = err instanceof Error ? err.message : 'That query could not be run.';
    }
  }

  const table = QUERYABLE_TABLES[state.table];

  return (
    <>
      <div className="page-header">
        <h1>Data QA search</h1>
        <p className="subtitle">
          Super-admin only. Choose what the results are, then build cards that filter on
          that row or on a related domain (a player&apos;s career, match stats, clubs, draft
          picks…) and chain them with AND/OR. Results always show the chosen table&apos;s
          columns, one row each -- for checking data, not for the public site.
        </p>
      </div>

      <section className="section">
        <QueryBuilderForm initialState={state} />
      </section>

      {error && (
        <div className="notice" role="alert" style={{ borderLeftColor: 'var(--loss)' }}>
          {error}
        </div>
      )}

      {results && (
        <section className="section">
          <h2>Results</h2>
          <p className="section-note">{results.total.toLocaleString('en-AU')} row{results.total === 1 ? '' : 's'} match</p>

          {results.total === 0 ? (
            <div className="empty">
              <h2>No rows match</h2>
              <p>Try widening a condition or removing a card.</p>
            </div>
          ) : (
            <>
              <CollapsibleTable title="Results">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {results.columns.map((key) => (
                          <th scope="col" key={key}>{table.columns[key].label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.rows.map((row, i) => (
                        <tr key={i}>
                          {results!.columns.map((key) => (
                            <td key={key}>{formatCell(row[key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleTable>

              <Pagination
                basePath="/admin/query-builder"
                params={{ q: token }}
                page={state.page}
                pageSize={QB_LIMITS.defaultPageSize}
                total={results.total}
              />
            </>
          )}
        </section>
      )}
    </>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
