'use client';

import { useState } from 'react';

import { copySeasonListsForwardAction } from '@/app/admin/season-lists/actions';
import { type CopyForwardActionState, useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';

/**
 * Copy-forward (AFLDB-ISSUE-161 §11a): carries each SELECTED club's
 * (season-1) LIST onto its `season` identity — never appearances. Preview
 * (`dryRun: true`) runs the identical server code path up to the first
 * write and returns the plan; nothing is written until the operator
 * confirms. Refused before any write if a selected club already holds
 * `season` rows or has no `season` identity (the backend names them).
 *
 * Only rendered for a season with an earlier authoritative list to copy
 * (season > FIRST_LIST_SEASON) — 2027 has nothing to copy from (D-2) and
 * never reaches this component.
 */
export function CopyForwardPanel({
  season, emptyClubs,
}: {
  season: number;
  emptyClubs: { slug: string; name: string }[];
}) {
  const copy = useSeasonListActionSubmit<CopyForwardActionState>(copySeasonListsForwardAction, {});
  const [selected, setSelected] = useState<Set<string>>(new Set(emptyClubs.map((club) => club.slug)));

  const toggle = (slug: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
  });

  const buildForm = (dryRun: boolean): FormData => {
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('dryRun', dryRun ? '1' : '0');
    for (const slug of selected) formData.append('clubs', slug);
    return formData;
  };

  const handlePreview = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (selected.size === 0) return;
    copy.submit(buildForm(true), event.currentTarget);
  };

  const handleConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    copy.submit(buildForm(false), event.currentTarget);
  };

  const previewed = copy.state.ok === true && copy.state.dryRun === true;
  const done = copy.state.ok === true && copy.state.dryRun === false;

  if (done) {
    return (
      <section className="section">
        <h2>Copy forward from {season - 1}</h2>
        <p className="notice" role="status">{copy.state.message}</p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Copy forward from {season - 1}</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Carries each selected club&rsquo;s {season - 1} list onto its {season} identity, mapped by
        organisation. Refused before anything is written if any selected club already holds{' '}
        {season} rows, or has no {season} identity.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Select</span></th>
              <th scope="col">Club</th>
            </tr>
          </thead>
          <tbody>
            {emptyClubs.map((club) => (
              <tr key={club.slug}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(club.slug)}
                    onChange={() => toggle(club.slug)}
                    aria-label={`Copy forward into ${club.name}`}
                    disabled={copy.isPending}
                  />
                </td>
                <td>{club.name}</td>
              </tr>
            ))}
            {emptyClubs.length === 0 && (
              <tr><td colSpan={2} className="muted">Every eligible club already has a {season} list.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {copy.state.error && <p className="notice" role="alert">{copy.state.error}</p>}

      {previewed ? (
        <div style={{ marginTop: '0.6rem' }}>
          <p>
            <strong>{copy.state.copied}</strong> player{copy.state.copied === 1 ? '' : 's'} would be
            copied across {copy.state.plan?.length ?? 0} club{(copy.state.plan?.length ?? 0) === 1 ? '' : 's'}:
          </p>
          <ul>
            {copy.state.plan?.map((plan) => (
              <li key={plan.clubSlug}>{plan.clubName}: {plan.players} from {plan.fromClubSlug}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={copy.isPending}>
              {copy.isPending ? 'Copying…' : 'Confirm copy forward'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: '0.6rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePreview}
            disabled={copy.isPending || selected.size === 0 || emptyClubs.length === 0}
          >
            {copy.isPending ? 'Previewing…' : 'Preview copy forward'}
          </button>
        </div>
      )}
    </section>
  );
}
