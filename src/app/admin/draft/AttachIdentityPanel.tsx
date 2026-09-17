'use client';

import { useRef } from 'react';

import { attachAflTablesIdentityAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

/**
 * Attach a manual player's AFL Tables profile identity once the source
 * publishes them (§6.5, the debut case §8.4). This is an explicit human
 * identity decision, never a name-based inference: the server re-resolves
 * and re-checks everything (a path already claimed by another player, this
 * player already holding one, a tracked profile-continuity rule) inside the
 * writing transaction. Attaching FIRST is what makes the future safe -- the
 * very next settle and the next fitzRoy import both resolve onto this
 * player instead of inserting a duplicate.
 */
export function AttachIdentityPanel({ playerId, displayName }: { playerId: number; displayName: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const attach = useDraftActionSubmit(attachAflTablesIdentityAction);

  const handleAttach = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set('playerId', String(playerId));
    attach.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Attach an AFL Tables identity</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        {displayName} was created manually and carries no AFL Tables identity yet. Once the source
        publishes a profile for this person, attach its path here — never by name — so a future
        settle or fitzRoy import resolves onto this player instead of creating a second one.
      </p>
      <form ref={formRef} onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: '0.5rem', maxWidth: '26rem' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          AFL Tables profile path
          <input
            type="text"
            name="profilePath"
            placeholder="players/S/Some_Player0.html"
            maxLength={200}
            disabled={attach.isPending}
          />
        </label>
        {attach.state.error && <p className="notice" role="alert">{attach.state.error}</p>}
        {attach.state.ok && attach.state.message && <p className="notice" role="status">{attach.state.message}</p>}
        <div>
          <button type="button" className="btn btn-primary" onClick={handleAttach} disabled={attach.isPending}>
            {attach.isPending ? 'Attaching…' : 'Attach identity'}
          </button>
        </div>
      </form>
    </section>
  );
}
