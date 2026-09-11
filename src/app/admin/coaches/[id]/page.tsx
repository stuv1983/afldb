import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AssignmentPanel } from '@/app/admin/coaches/AssignmentPanel';
import { LinkagePanel } from '@/app/admin/coaches/LinkagePanel';
import { MetadataPanel } from '@/app/admin/coaches/MetadataPanel';
import {
  getCoachAdminDetail,
  listClubOptionsForAdmin,
  listClubSeasonMatches,
  readCoachOverrides,
} from '@/db/queries/admin-coaches';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { coachPath } from '@/lib/format';
import { firstValue } from '@/lib/params';
import { coachSlug } from '@/lib/slugs';

export const metadata: Metadata = { title: 'Coach', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/coaches/[id]` -- the four panels of §9: identity/provenance
 * (read-only, this file), editable metadata, player linkage and coaching
 * assignments (each its own client panel). Every mutation is Super Admin
 * only; a plain Admin reaches this page (`data.coaches.read`) and sees the
 * same facts with no editing controls.
 */
export default async function CoachAdminDetailPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const admin = await requireCapability('data.coaches.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const detail = await getCoachAdminDetail(id);
  if (!detail) notFound();

  const overrides = await readCoachOverrides(detail.afltablesCoachPath);
  const identityOverride = overrides.find((o) => o.fieldGroup === 'identity' && o.isActive) ?? null;
  const linkageOverride = overrides.find((o) => o.fieldGroup === 'linkage' && o.isActive) ?? null;

  const canEdit = hasCapability(admin, 'data.coaches.edit');

  const query = await searchParams;
  const rawClub = Number(firstValue(query.assignClub) ?? '');
  const selectedClubId = Number.isInteger(rawClub) && rawClub > 0 ? rawClub : null;
  const rawSeason = Number(firstValue(query.assignSeason) ?? '');
  const selectedSeason = Number.isInteger(rawSeason) && rawSeason >= 1897 && rawSeason <= 2200 ? rawSeason : null;

  const [clubOptions, assignmentRows] = await Promise.all([
    listClubOptionsForAdmin(),
    selectedClubId !== null && selectedSeason !== null
      ? listClubSeasonMatches(selectedClubId, selectedSeason)
      : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="page-header">
        <h1>{detail.displayName}</h1>
        <p className="subtitle">
          <Link href="/admin/coaches">← Coaches</Link>
          {' · '}
          <a href={coachPath(coachSlug(detail.displayName), detail.id)}>View public page</a>
          {' · '}
          <Link href={`/admin/audit/entity/coaches/${detail.id}`}>Audit trail</Link>
        </p>
      </div>

      <section className="section">
        <h2>Identity &amp; provenance</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Provenance</th>
                <td><span className="badge">{detail.provenance === 'manual' ? 'Manual' : 'AFL Tables'}</span></td>
                <th scope="row">Identity path</th>
                <td>{detail.afltablesCoachPath}</td>
              </tr>
              <tr>
                <th scope="row">Name key</th>
                <td>{detail.nameKey}</td>
                <th scope="row">Source</th>
                <td>{detail.sourceKey}</td>
              </tr>
              <tr>
                <th scope="row">Source record id</th>
                <td>{detail.sourceRecordId}</td>
                <th scope="row">Import batch</th>
                <td>{detail.importBatchId ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Games coached (source evidence)</th>
                <td>{detail.sourceGamesCoached ?? '—'}</td>
                <th scope="row">Profile path</th>
                <td>{detail.afltablesProfilePath ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {canEdit ? (
        <MetadataPanel
          coachId={detail.id}
          displayName={detail.displayName}
          givenName={detail.givenName}
          surname={detail.surname}
          dob={detail.dob}
          notes={detail.notes}
          hasActiveOverride={identityOverride !== null}
        />
      ) : (
        <section className="section">
          <h2>Metadata</h2>
          <p className="muted">
            {detail.givenName ?? '—'} {detail.surname ?? ''} · born {detail.dob ?? 'unrecorded'}
            {identityOverride && ' · identity override active'}
          </p>
          {detail.notes && <p>{detail.notes}</p>}
        </section>
      )}

      {canEdit ? (
        <LinkagePanel
          coachId={detail.id}
          linkStatusValue={detail.linkStatusValue}
          playerId={detail.playerId}
          playerSlug={detail.playerSlug}
          playerDisplayName={detail.playerDisplayName}
          hasActiveOverride={linkageOverride !== null}
        />
      ) : (
        <section className="section">
          <h2>Player linkage</h2>
          {detail.playerId !== null && detail.playerSlug !== null ? (
            <p>Linked to <a href={`/players/${detail.playerSlug}-${detail.playerId}`}>{detail.playerDisplayName}</a></p>
          ) : (
            <p className="muted">Not linked to a player.</p>
          )}
        </section>
      )}

      {canEdit && (
        <AssignmentPanel
          coachId={detail.id}
          clubOptions={clubOptions}
          selectedClubId={selectedClubId}
          selectedSeason={selectedSeason}
          rows={assignmentRows}
        />
      )}
    </>
  );
}
