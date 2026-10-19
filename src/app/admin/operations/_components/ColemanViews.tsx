import type {
  ColemanComparisonView,
  ColemanPublicationView,
} from '@/lib/admin/operations-centre';

import { formatInstant, shortChecksum } from '../format';

/**
 * Pure presentation of the Coleman Medal derivation and its publications (AFLDB V2 Stage 5, plan
 * D9; ADR 0006). CLIENT-SAFE: only erased type imports and the tiny `format` module, because the
 * Coleman workbench (a Client Component) renders {@link ColemanComparisonResult} from the action's
 * state. Players appear by stable id and AFL Tables profile path, never by name alone.
 */

const PLAN_WORDS: Record<NonNullable<ColemanComparisonView['plan']>, string> = {
  published: 'Publishing now would record the FIRST publication for this season.',
  unchanged: 'Publishing now would write nothing: the current publication already matches this derivation.',
  superseded: 'Publishing now would append a NEW row that supersedes the current publication.',
};

const CATEGORY_LABELS = { agree: 'Agrees', disagree: 'Disagrees', not_derivable: 'Not derivable' } as const;

export function ColemanPublicationsTable({ publications }: { publications: readonly ColemanPublicationView[] }) {
  if (publications.length === 0) {
    return (
      <p className="empty" data-empty-publications="true">
        No Coleman result has been published yet.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Current Coleman publications, newest season first</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Season</th>
            <th scope="col" className="num">Row</th>
            <th scope="col">Derivation</th>
            <th scope="col">Winners (durable keys)</th>
            <th scope="col">Input checksum</th>
            <th scope="col">Derived</th>
            <th scope="col">Published</th>
            <th scope="col">By</th>
            <th scope="col">Supersedes</th>
          </tr>
        </thead>
        <tbody>
          {publications.map((publication) => (
            <tr key={publication.id}>
              <td className="num">{publication.season}</td>
              <td className="num">#{publication.id}</td>
              <td className="mono">v{publication.methodVersion} · {publication.derivationVersion}</td>
              <td className="mono" style={{ overflowWrap: 'anywhere' }}>{publication.winnerKeys.join(', ')}</td>
              <td className="mono" title={publication.inputChecksum}>{shortChecksum(publication.inputChecksum)}</td>
              <td className="nowrap">{formatInstant(publication.derivedAt)}</td>
              <td className="nowrap">{formatInstant(publication.publishedAt)}</td>
              <td>user #{publication.publishedBy}</td>
              <td>{publication.supersedesId === null ? '—' : `#${publication.supersedesId}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ColemanComparisonResult({ comparison }: { comparison: ColemanComparisonView }) {
  const derivation = comparison.derivation;
  const season = comparison.report.seasons[0] ?? null;
  return (
    <div data-coleman-comparison={comparison.season}>
      <h3>Season {comparison.season}: comparison</h3>
      <dl className="audit-kv">
        <dt>Generated</dt>
        <dd>{formatInstant(comparison.generatedAt)}</dd>
        <dt>Settled attested</dt>
        <dd>{comparison.settled ? 'yes' : 'no — the derivation refuses without the attestation'}</dd>
        <dt>Sealed season</dt>
        <dd>{comparison.sealed ? 'yes' : 'no — only a sealed season can be published'}</dd>
        <dt>Comparison category</dt>
        <dd>
          {season === null
            ? '—'
            : <span className={season.category === 'agree' ? 'badge' : 'badge badge-warn'}>{CATEGORY_LABELS[season.category]}</span>}
          {season !== null && season.category === 'agree' && ' the stored active Coleman winners.'}
          {season !== null && season.category === 'disagree' && ' with the stored active Coleman winners (see below).'}
          {season !== null && season.category === 'not_derivable' && ' The derivation refused, so the stored rows are listed, not judged.'}
        </dd>
        <dt>Publication plan</dt>
        <dd>{comparison.plan === null ? 'Publishing is not possible for this season (not derivable, or not sealed).' : PLAN_WORDS[comparison.plan]}</dd>
        <dt>Current publication</dt>
        <dd>
          {comparison.current === null
            ? 'none'
            : `#${comparison.current.id} (v${comparison.current.methodVersion} · ${comparison.current.derivationVersion}), published ${formatInstant(comparison.current.publishedAt)} by user #${comparison.current.publishedBy}`}
        </dd>
      </dl>

      {derivation.derivable ? (
        <>
          <h4>Derivation</h4>
          <dl className="audit-kv">
            <dt>Method</dt>
            <dd>v{derivation.methodVersion} · {derivation.derivationVersion}</dd>
            <dt>Input checksum</dt>
            <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{derivation.inputChecksum}</dd>
            <dt>Derived at</dt>
            <dd>{formatInstant(derivation.derivedAt)}</dd>
            <dt>Top goals</dt>
            <dd>{derivation.maxGoals ?? 'not recorded'} (minimum qualifying: {derivation.minimumGoals}){derivation.tie ? ', a tie' : ''}</dd>
            <dt>Rows read</dt>
            <dd>
              {derivation.counts.homeAndAwayMatches} home-and-away matches, {derivation.counts.homeAndAwayGoalRows} goal rows,
              {' '}{derivation.counts.players} players; {derivation.counts.finalsMatches} finals matches
              ({derivation.counts.finalsRowsExcluded} finals rows excluded)
            </dd>
          </dl>
          <h4>{derivation.winners.length === 1 ? 'Derived winner' : 'Derived winners'}</h4>
          {derivation.winners.length === 0 && (
            <p className="muted">No winner: the top total is below the contract&apos;s minimum, which is a reported outcome, not an error.</p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player id</th>
                  <th scope="col">Profile path</th>
                  <th scope="col" className="num">Goals</th>
                  <th scope="col">Club</th>
                  <th scope="col">Durable key</th>
                </tr>
              </thead>
              <tbody>
                {derivation.winners.map((winner) => (
                  <tr key={winner.key}>
                    <td className="mono">{winner.playerId}</td>
                    <td className="mono">{winner.profilePath}</td>
                    <td className="num">{winner.goals}</td>
                    <td className="mono">{winner.clubId ?? `${winner.clubCount} clubs`}</td>
                    <td className="mono" style={{ overflowWrap: 'anywhere' }}>{winner.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Leaderboard (top {derivation.leaderboardTop.length} of {derivation.leaderboardSize})</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player id</th>
                  <th scope="col">Profile path</th>
                  <th scope="col" className="num">Goals</th>
                  <th scope="col">Clubs</th>
                </tr>
              </thead>
              <tbody>
                {derivation.leaderboardTop.map((entry) => (
                  <tr key={entry.playerId}>
                    <td className="mono">{entry.playerId}</td>
                    <td className="mono">{entry.profilePath ?? <span className="muted">none or several</span>}</td>
                    <td className="num">{entry.goals}</td>
                    <td className="mono">{entry.clubIds.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="notice" role="alert" data-derivation-refused={derivation.refusal.code}>
          <strong>The derivation refused this season.</strong>{' '}
          <span className="mono">{derivation.refusal.code}</span>: {derivation.refusal.message}
        </p>
      )}

      {season !== null && season.category === 'disagree' && (
        <>
          <h4>Differences from the stored active rows</h4>
          <ul className="ruled-list">
            <li>Derived winners with no stored active row: {season.missing.length === 0 ? 'none' : season.missing.map((w) => w.key).join(', ')}</li>
            <li>Stored active rows matching no derived winner: {season.extra.length}</li>
            <li>Derived winners matched by more than one stored row: {season.duplicates.length}</li>
            <li>Stored rows ignored (not active): {season.ignored.length}</li>
          </ul>
        </>
      )}
    </div>
  );
}
