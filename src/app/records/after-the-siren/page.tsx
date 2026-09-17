import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import { type AfterSirenOccurrence, getAfterSirenRecords } from '@/db/queries/after-siren';
import { formatDate, formatNumber, matchPath, playerPath, seasonPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 86400;

const TITLE = 'After-the-Siren Records';
const DEFINITION =
  'Players recognised for a shot at goal after the siren has sounded to end a term, from '
  + 'AFLDB’s recorded after-the-siren kicks.';

export const metadata: Metadata = pageMetadata({
  title: `${TITLE} — Most Attempts and Most Goals`,
  description: DEFINITION,
  path: '/records/after-the-siren',
});

const EFFECT_LABEL: Record<AfterSirenOccurrence['kickEffect'], string | null> = {
  won: 'won the match',
  drew: 'drew the match',
  none: null,
};

function OccurrenceNote({ occurrence }: { occurrence: AfterSirenOccurrence }) {
  const effect = EFFECT_LABEL[occurrence.kickEffect];
  return (
    <div className="note">
      {occurrence.matchId !== null
        ? <Link href={matchPath(occurrence.matchId)}>{occurrence.roundRaw}</Link>
        : occurrence.roundRaw}
      {' '}
      <Link href={seasonPath(occurrence.season)}>{occurrence.season}</Link>
      {occurrence.opponentName && <> vs {occurrence.opponentName}</>}
      {occurrence.matchDate && <> · {formatDate(occurrence.matchDate)}</>}
      {effect && <> · {effect}</>}
    </div>
  );
}

export default async function AfterSirenRecordsPage() {
  const rows = await getAfterSirenRecords();
  const byAttempts = [...rows].sort((a, b) => b.attempts - a.attempts).slice(0, 50);
  const byGoals = rows
    .filter((r) => r.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, 50);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Records', href: '/records' }, { label: TITLE }]} />

      <div className="page-header">
        <h1>{TITLE}</h1>
        <p className="subtitle">{DEFINITION}</p>
      </div>

      <section className="section">
        <CollapsibleTable id="most-attempts" title="Most attempts" note={`${byAttempts.length} shown`} defaultOpen>
          <div className="table-wrap">
            <SortableTable
              defaultSort="attempts"
              defaultDir="desc"
              columns={[
                { key: 'player', label: 'Player', sortType: 'text' },
                { key: 'attempts', label: 'Attempts', sortType: 'number', className: 'num' },
                { key: 'goals', label: 'Goals', sortType: 'number', className: 'num' },
                { key: 'behinds', label: 'Behinds', sortType: 'number', className: 'num' },
                { key: 'misses', label: 'Misses', sortType: 'number', className: 'num' },
              ]}
              items={byAttempts.map((r) => ({
                id: String(r.playerId),
                values: {
                  player: r.displayName,
                  attempts: r.attempts,
                  goals: r.goals,
                  behinds: r.behinds,
                  misses: r.misses,
                },
                element: (
                  <tr key={r.playerId}>
                    <td className="wide">
                      <Link href={playerPath(r.slug, r.playerId)}>{r.displayName}</Link>
                      <OccurrenceNote occurrence={r.firstAttempt} />
                      {r.lastAttempt.matchId !== r.firstAttempt.matchId
                        && <OccurrenceNote occurrence={r.lastAttempt} />}
                    </td>
                    <td className="num">{formatNumber(r.attempts)}</td>
                    <td className="num">{formatNumber(r.goals)}</td>
                    <td className="num">{formatNumber(r.behinds)}</td>
                    <td className="num">{formatNumber(r.misses)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable id="most-goals" title="Most goals" note={`${byGoals.length} shown`}>
          <div className="table-wrap">
            <SortableTable
              defaultSort="goals"
              defaultDir="desc"
              columns={[
                { key: 'player', label: 'Player', sortType: 'text' },
                { key: 'goals', label: 'Goals', sortType: 'number', className: 'num' },
                { key: 'goalsToWin', label: 'To win', sortType: 'number', className: 'num' },
                { key: 'goalsToDraw', label: 'To draw', sortType: 'number', className: 'num' },
              ]}
              items={byGoals.map((r) => ({
                id: String(r.playerId),
                values: {
                  player: r.displayName,
                  goals: r.goals,
                  goalsToWin: r.goalsToWin,
                  goalsToDraw: r.goalsToDraw,
                },
                element: (
                  <tr key={r.playerId}>
                    <td className="wide">
                      <Link href={playerPath(r.slug, r.playerId)}>{r.displayName}</Link>
                      {r.firstGoal && <OccurrenceNote occurrence={r.firstGoal} />}
                      {r.lastGoal && r.lastGoal.matchId !== r.firstGoal?.matchId
                        && <OccurrenceNote occurrence={r.lastGoal} />}
                    </td>
                    <td className="num">{formatNumber(r.goals)}</td>
                    <td className="num">{formatNumber(r.goalsToWin)}</td>
                    <td className="num">{formatNumber(r.goalsToDraw)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <h2>About this record</h2>
        <p>
          &ldquo;Most attempts&rdquo; is drawn from every recorded after-the-siren shot, whatever
          the outcome; &ldquo;most goals&rdquo; and its first/latest dates are drawn only from the
          goal rows, so a player&rsquo;s earliest recorded miss can never stand in for their
          earliest recorded goal.
        </p>
        <p className="muted">
          See <Link href="/records/first-kick-goal">Goal with first VFL/AFL kick</Link> for the
          related career-opening record.
        </p>
      </section>
    </>
  );
}
