'use client';

import { useState, useTransition } from 'react';

import { linkCoachToPlayerAction, retireCoachOverrideAction, searchPlayersForLinkAction, unlinkCoachAction } from '@/app/admin/coaches/actions';
import { useCoachActionSubmit } from '@/app/admin/coaches/submit-helper';
import type { SearchResult } from '@/db/queries/search';

/**
 * Panel 3 of `/admin/coaches/[id]` (§9, §4.3). Resolution goes through the
 * player's AFL Tables profile path, never by name: `linkCoachToPlayerAction`
 * re-resolves and re-checks everything server-side (duplicate coach,
 * missing profile, a tracked `profile_link_corrections` rule) inside the
 * writing transaction, so nothing selected here is trusted, only proposed.
 */
export function LinkagePanel({
  coachId,
  linkStatusValue,
  playerId,
  playerSlug,
  playerDisplayName,
  hasActiveOverride,
}: {
  coachId: number;
  linkStatusValue: string;
  playerId: number | null;
  playerSlug: string | null;
  playerDisplayName: string | null;
  hasActiveOverride: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();
  const link = useCoachActionSubmit(linkCoachToPlayerAction);
  const unlink = useCoachActionSubmit(unlinkCoachAction);
  const retire = useCoachActionSubmit(retireCoachOverrideAction);

  const runSearch = (value: string) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      setResults(await searchPlayersForLinkAction(value));
    });
  };

  const handleLink = (event: React.MouseEvent<HTMLButtonElement>, candidateId: number) => {
    const formData = new FormData();
    formData.set('coachId', String(coachId));
    formData.set('playerId', String(candidateId));
    link.submit(formData, event.currentTarget);
  };

  const handleUnlink = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('coachId', String(coachId));
    unlink.submit(formData, event.currentTarget);
  };

  const handleRetire = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('coachId', String(coachId));
    formData.set('fieldGroup', 'linkage');
    retire.submit(formData, event.currentTarget);
  };

  const isPending = link.isPending || unlink.isPending || retire.isPending;

  return (
    <section className="section">
      <h2>Player linkage</h2>
      {playerId !== null && playerSlug !== null ? (
        <>
          <p>
            Linked to <a href={`/players/${playerSlug}-${playerId}`}>{playerDisplayName}</a>
            {' '}(link status: {linkStatusValue}).
          </p>
          <button type="button" className="btn btn-secondary" onClick={handleUnlink} disabled={isPending}>
            {unlink.isPending ? 'Unlinking…' : 'Unlink'}
          </button>
          {unlink.state.error && <p className="notice" role="alert">{unlink.state.error}</p>}
        </>
      ) : (
        <>
          <p className="muted">Not linked to a player (link status: {linkStatusValue}).</p>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', maxWidth: '24rem' }}>
            Search for a player
            <input
              type="search"
              value={query}
              onChange={(event) => runSearch(event.target.value)}
              placeholder="Player name…"
              disabled={isPending}
            />
          </label>
          {searching && <p className="muted">Searching…</p>}
          {results.length > 0 && (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
              {results.map((r) => (
                <li key={r.id} style={{ margin: '0.2rem 0' }}>
                  {r.title}
                  {r.subtitle && <span className="muted"> — {r.subtitle}</span>}
                  {' '}
                  <button type="button" className="btn btn-secondary" onClick={(e) => handleLink(e, r.id)} disabled={isPending}>
                    {link.isPending ? 'Linking…' : 'Link'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {link.state.error && <p className="notice" role="alert">{link.state.error}</p>}
        </>
      )}
      {link.state.ok && link.state.message && <p className="notice" role="status">{link.state.message}</p>}
      {unlink.state.ok && unlink.state.message && <p className="notice" role="status">{unlink.state.message}</p>}
      {hasActiveOverride && (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          A linkage override is active and survives a source reload and a promotion.
          {' '}
          <button type="button" className="btn btn-secondary" onClick={handleRetire} disabled={isPending}>
            {retire.isPending ? 'Retiring…' : 'Retire this override'}
          </button>
        </p>
      )}
      {retire.state.error && <p className="notice" role="alert">{retire.state.error}</p>}
      {retire.state.ok && retire.state.message && <p className="notice" role="status">{retire.state.message}</p>}
    </section>
  );
}
