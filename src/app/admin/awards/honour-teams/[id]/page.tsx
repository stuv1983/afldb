import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { HonourTeamCorrectionPanel } from '@/app/admin/awards/HonourTeamCorrectionPanel';
import { AWARDS_ROOT, domainListPath } from '@/app/admin/awards/labels';
import { LifecyclePanel } from '@/app/admin/awards/LifecyclePanel';
import { AwardsCrumb, RecordFacts } from '@/app/admin/awards/RecordFacts';
import { RecordHistory } from '@/app/admin/awards/RecordHistory';
import { ReplacePanel } from '@/app/admin/awards/ReplacePanel';
import {
  listHonourTeamNamesForAdmin, provenanceOf, readHonourOverrides,
  readHonourTeamEntityKey, readHonourTeamMember,
} from '@/db/queries/admin-awards';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { playerPath } from '@/lib/format';

export const metadata: Metadata = { title: 'Honour team selection', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/awards/honour-teams/[id]` — one representative-team selection
 * (AFLDB-ISSUE-165 §6.4, §6.5).
 *
 * The team and the selected person are identity. Migration 059 made that
 * explicit after ISSUE-025, where a same-named different player could
 * overwrite someone else's selection, so this domain in particular must never
 * offer either as an editable field — a replacement instead goes through the
 * same collision check a creation does, under the same advisory lock the
 * importer contends on.
 */
export default async function HonourTeamDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireCapability('data.awards.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const row = await readHonourTeamMember(id);
  if (!row) notFound();

  const canEdit = hasCapability(admin, 'data.awards.edit');
  const [teams, entityKey] = await Promise.all([
    canEdit ? listHonourTeamNamesForAdmin() : Promise.resolve([]),
    readHonourTeamEntityKey(row),
  ]);
  const overrides = entityKey ? await readHonourOverrides('honour_team_members', entityKey) : [];

  const summary = `${row.teamName} — ${row.playerNameRaw}${row.position ? ` (${row.position})` : ''}`;

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={domainListPath('honour-teams')} label="Honour &amp; representative teams" />
        <h1>{row.playerNameRaw}</h1>
        <p className="subtitle">
          {row.teamName}
          {row.position && <> · {row.position}</>}
          {row.role && <> · {row.role}</>}
          {row.playerId !== null && row.playerSlug && (
            <> · <a href={playerPath(row.playerSlug, row.playerId)}>View public page</a></>
          )}
          {' · '}<Link href={AWARDS_ROOT}>All honours domains</Link>
        </p>
      </div>

      <RecordFacts
        domain="honour-teams"
        rowId={row.id}
        entityKey={entityKey}
        provenance={provenanceOf(row.sourceKey)}
        sourceKey={row.sourceKey}
        status={row.status}
        statusReason={row.statusReason}
        updatedAt={row.updatedAt}
        identity={[
          { label: 'Team', value: row.teamName },
          {
            label: 'Selected person',
            value: row.playerId !== null
              ? <>{row.playerNameRaw} (player #{row.playerId})</>
              : <>{row.playerNameRaw} <span className="muted">— not linked to a player</span></>,
          },
          { label: 'Player link status', value: row.linkStatus },
        ]}
        overrides={overrides}
      />

      {canEdit ? (
        <>
          {row.status === 'active' && <HonourTeamCorrectionPanel row={row} />}
          <LifecyclePanel
            domain="honour-teams"
            rowId={row.id}
            expectedUpdatedAt={row.updatedAt}
            status={row.status}
            statusReason={row.statusReason}
          />
          {row.status === 'active' && (
            <ReplacePanel
              domain="honour-teams"
              rowId={row.id}
              expectedUpdatedAt={row.updatedAt}
              currentSummary={summary}
              existingTeams={teams}
            />
          )}
        </>
      ) : (
        <section className="section">
          <h2>Recorded detail</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th scope="row">Position</th><td>{row.position ?? '—'}</td>
                  <th scope="row">Role</th><td>{row.role ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Club(s)</th><td>{row.clubNameRaw ?? '—'}</td>
                  <th scope="row">Lineup order</th><td>{row.sortOrder}</td>
                </tr>
                <tr>
                  <th scope="row">Note</th><td colSpan={3}>{row.note ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">
            Correcting, voiding, reinstating and replacing a selection are Super Admin actions.
          </p>
        </section>
      )}

      <RecordHistory table="honour_team_members" rowId={row.id} />
    </>
  );
}
