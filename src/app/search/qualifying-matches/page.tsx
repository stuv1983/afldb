import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { answerTeamAggregateDrilldown } from '@/db/queries/nl/team-match';
import { clubPath, formatDate, formatNumber, formatRoundShort, matchPath } from '@/lib/format';
import type { NlTeamMatchRow } from '@/search/nl/answer-types';
import { validateQualifyingMatchesRequest } from '@/search/nl/qualifying-matches-gate';

export const metadata: Metadata = {
  title: 'Qualifying Matches',
  robots: { index: false, follow: false },
};

export default async function QualifyingMatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const validationResult = validateQualifyingMatchesRequest(params.plan, params.club);
  if ('error' in validationResult) {
    return notFound();
  }

  const { rawPlan, clubParam } = validationResult;

  const result = await answerTeamAggregateDrilldown(rawPlan, clubParam);

  const rows = result.rows as NlTeamMatchRow[];

  if (rows.length === 0) {
    return (
      <div className="empty">
        <h2>No qualifying matches</h2>
        <p>No matches match the requested criteria.</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Qualifying Matches</h1>
      </div>

      <section className="section">
        <CollapsibleTable title="Every qualifying game" note={`${formatNumber(result.total)} total`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col">Opponent</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col">Match</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.matchId}-${r.clubSlug}`}>
                    <td className="wide"><Link href={clubPath(r.clubSlug)}>{r.clubName}</Link></td>
                    <td><Link href={clubPath(r.opponentSlug)}>{r.opponentName}</Link></td>
                    <td className="num nowrap">{r.clubScore}–{r.opponentScore}</td>
                    <td className="nowrap">
                      <Link href={matchPath(r.matchId)}>
                        {r.season} {formatRoundShort(r.roundType, r.roundNumber)}
                      </Link>
                      {' '}
                      <span className="muted">{formatDate(r.matchDate)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
        {result.total > rows.length && (
          <p className="muted" style={{ marginTop: '0.6rem' }}>
            Showing {rows.length} of {formatNumber(result.total)}.
          </p>
        )}
      </section>
    </>
  );
}
