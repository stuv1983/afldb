import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  getBrownlowMatchEditorModel,
  getBrownlowRound,
  getBrownlowSeasonOverview,
} from '@/db/queries/admin-brownlow';
import { requireCapability } from '@/lib/auth/session';
import { parseSeason } from '@/lib/params';

import { RoundMatches } from './RoundMatches';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brownlow round',
  robots: { index: false, follow: false },
};

export default async function BrownlowRoundPage({
  params,
}: {
  params: Promise<{ season: string; round: string }>;
}) {
  const viewer = await requireCapability('data.brownlow.read');
  const { season: seasonRaw, round: roundRaw } = await params;

  const season = parseSeason(seasonRaw);
  const round = Number(roundRaw);
  if (season === undefined || !Number.isInteger(round) || round < 1) notFound();

  const overview = await getBrownlowSeasonOverview(season);
  if (!overview || !overview.polled) notFound();

  const roundMatches = await getBrownlowRound(season, round);
  if (roundMatches.length === 0) notFound();

  const models = (
    await Promise.all(roundMatches.map((match) => getBrownlowMatchEditorModel(match.matchId)))
  ).filter((model): model is NonNullable<typeof model> => model !== null);

  const roundNumbers = overview.rounds.map((r) => r.roundNumber);
  const position = roundNumbers.indexOf(round);
  const prevRound = position > 0 ? roundNumbers[position - 1] : null;
  const nextRound = position >= 0 && position < roundNumbers.length - 1
    ? roundNumbers[position + 1]
    : null;

  const accounted = roundMatches.filter(
    (m) => m.status === 'void' || m.assignment === 'complete',
  ).length;

  return (
    <>
      <div className="page-header">
        <p className="section-note" style={{ marginBottom: '0.35rem' }}>
          <Link href="/admin/brownlow">Brownlow administration</Link>
          {' / '}
          <Link href={`/admin/brownlow/${season}`}>{season}</Link>
        </p>
        <h1>{season} — Round {round}</h1>
        <p className="subtitle">
          {accounted} of {roundMatches.length} home-and-away match{roundMatches.length === 1 ? '' : 'es'}{' '}
          finalised, voided or complete from source.
          {viewer.role === 'super_admin'
            ? ' You can save drafts, finalise, correct and void.'
            : ' You can save drafts; a Super Admin finalises, corrects and voids.'}
        </p>
      </div>

      <nav
        aria-label="Round navigation"
        style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}
      >
        {prevRound !== null && (
          <Link className="btn btn-secondary" href={`/admin/brownlow/${season}/${prevRound}`}>
            ← Round {prevRound}
          </Link>
        )}
        {nextRound !== null && (
          <Link className="btn btn-secondary" href={`/admin/brownlow/${season}/${nextRound}`}>
            Round {nextRound} →
          </Link>
        )}
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Finals are not shown here: no Brownlow votes are awarded in finals.
        </span>
      </nav>

      {models.length !== roundMatches.length && (
        <p className="notice" role="status">
          {roundMatches.length - models.length} match(es) in this round could not be loaded for editing
          and are not shown.
        </p>
      )}

      <RoundMatches
        models={models}
        season={season}
        round={round}
        canFinalise={viewer.role === 'super_admin'}
      />
    </>
  );
}
