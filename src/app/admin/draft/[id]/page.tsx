import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdoptPanel } from '@/app/admin/draft/AdoptPanel';
import { AttachIdentityPanel } from '@/app/admin/draft/AttachIdentityPanel';
import { ManualPickPanel } from '@/app/admin/draft/ManualPickPanel';
import { RetirePanel } from '@/app/admin/draft/RetirePanel';
import { SourceFieldsPanel } from '@/app/admin/draft/SourceFieldsPanel';
import { SupersedePanel } from '@/app/admin/draft/SupersedePanel';
import { sql } from '@/db/client';
import { listClubs } from '@/db/queries/clubs';
import {
  DRAFT_EVENT_PAIRS,
  getDraftPickAdminDetail,
  listManualPlayersAwaitingIdentity,
  MANUAL_SOURCE_KEY,
  needsPlayerLinkReview,
  playerLinksHref,
  readDraftOverrides,
} from '@/db/queries/admin-draft';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { playerPath } from '@/lib/format';

export const metadata: Metadata = { title: 'Draft selection', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PROVENANCE_LABELS: Record<string, string> = {
  draftguru: 'DraftGuru (source-owned)',
  manual: 'Manual (AFLDB-ISSUE-160)',
  legacy: 'Legacy — no provenance (pre-160)',
};

/** The stable revision value J-18's compare-and-swap checks -- see `draftPickRevision` in `admin-draft.ts`; recomputed here read-only, outside a transaction, purely for display/hidden-field use. */
async function currentRevision(pickId: number, playerId: number | null): Promise<string> {
  const [row] = await sql<{ revision: string | null }[]>`
    SELECT max(id)::text AS revision
      FROM data_edits
     WHERE (table_name = 'draft_picks' AND row_id = ${pickId})
        OR (table_name = 'players' AND row_id = ${playerId} AND field_group LIKE 'draft_selection%')
  `;
  return row?.revision ?? '0';
}

/**
 * `/admin/draft/[id]` -- identity/provenance (read-only), then exactly the
 * bounded edit panel the row's provenance admits (AFLDB-ISSUE-160 §18).
 * Admin (`data.draft.read`) sees every fact with no editing controls;
 * Super Admin (`data.draft.edit`) sees the panel Stage 1's mutation contract
 * supports for this row's provenance, and no other.
 */
export default async function DraftPickAdminDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireCapability('data.draft.read');
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const detail = await getDraftPickAdminDetail(id);
  if (!detail) notFound();

  const canEdit = hasCapability(admin, 'data.draft.edit');
  // Navigation only; /admin/player-links enforces its own capability and owns
  // the person-grained decision (J-17 refuses relinking a source row here).
  const canReviewLinks = hasCapability(admin, 'data.playerLinks');
  const [clubs, revision] = await Promise.all([listClubs(), currentRevision(detail.id, detail.playerId)]);

  const overrides = detail.entityKey ? await readDraftOverrides(detail.entityKey) : [];
  const activeGroups = new Set(overrides.filter((o) => o.isActive).map((o) => o.fieldGroup));

  // Only shown for a manual pick whose linked player carries a manual
  // identity with no AFL Tables identity yet -- reusing the exact read the
  // D-2 importer guard measures itself against, never a new query.
  const manualAwaiting = detail.provenance === 'manual' && detail.playerId !== null
    ? (await listManualPlayersAwaitingIdentity()).find((p) => p.playerId === detail.playerId) ?? null
    : null;

  // J-14: a source-owned selection for the same event already exists for
  // this player -- the manual row is a duplicate, offer 6.7 supersede.
  const duplicateSourceRow = detail.provenance === 'manual' && detail.playerId !== null
    ? (await sql<{ id: number; playerNameRaw: string }[]>`
        SELECT id, player_name_raw AS "playerNameRaw"
          FROM draft_picks
         WHERE player_id = ${detail.playerId}
           AND draft_year = ${detail.draftYear}
           AND draft_kind = ${detail.draftKind}
           AND source_id IS NOT NULL
           AND source_id <> (SELECT id FROM sources WHERE key = ${MANUAL_SOURCE_KEY})
         LIMIT 1
      `)[0] ?? null
    : null;

  const auditHref = detail.provenance === 'draftguru'
    ? `/admin/audit/entity/draft_picks/${detail.id}`
    : detail.playerId !== null
      ? `/admin/audit/entity/players/${detail.playerId}`
      : null;

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href="/admin/draft">← Draft administration</Link></p>
        <h1>{detail.playerNameRaw}</h1>
        <p className="subtitle">
          {detail.draftYear} {detail.draftType} ({detail.draftKind ?? '—'})
          {detail.pickNumber !== null && <> · Pick {detail.pickNumber}</>}
          {detail.clubName && <> · {detail.clubName}</>}
          {detail.playerId !== null && detail.playerSlug && (
            <> · <a href={playerPath(detail.playerSlug, detail.playerId)}>View public page</a></>
          )}
          {auditHref && <> · <Link href={auditHref}>Audit trail</Link></>}
        </p>
      </div>

      <section className="section">
        <h2>Identity &amp; provenance</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Provenance</th>
                <td><span className="badge">{PROVENANCE_LABELS[detail.provenance]}</span></td>
                <th scope="row">Entity key</th>
                <td style={{ wordBreak: 'break-all' }}>{detail.entityKey ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Player</th>
                <td>
                  {detail.playerId !== null
                    ? <>{detail.playerDisplayName} (#{detail.playerId})</>
                    : needsPlayerLinkReview(detail) && canReviewLinks
                      ? (
                        <>
                          <span className="muted">Unresolved — </span>
                          <Link href={playerLinksHref(detail)}>resolve in Player links</Link>
                        </>
                      )
                      : <span className="muted">Unresolved — link in Player links</span>}
                </td>
                <th scope="row">Link status</th>
                <td>{detail.linkStatusValue}</td>
              </tr>
              <tr>
                <th scope="row">Source player URL</th>
                <td style={{ wordBreak: 'break-all' }}>{detail.playerUrl ?? '—'}</td>
                <th scope="row">Active overrides</th>
                <td>{activeGroups.size > 0 ? [...activeGroups].join(', ') : 'none'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {detail.provenance === 'legacy' && (
        canEdit ? (
          <AdoptPanel pickId={detail.id} eventPairs={DRAFT_EVENT_PAIRS} defaultDraftType={detail.draftType} />
        ) : (
          <section className="section">
            <p className="muted">
              This selection carries no provenance (a pre-ISSUE-160 admin row) and cannot survive a
              source reload or a promotion until a Super Admin adopts it.
            </p>
          </section>
        )
      )}

      {detail.provenance === 'draftguru' && (
        canEdit ? (
          <SourceFieldsPanel
            pickId={detail.id}
            clubs={clubs.map((c) => ({ slug: c.slug, name: c.name }))}
            values={{
              playerNameRaw: detail.playerNameRaw,
              originalClubRaw: detail.originalClubRaw,
              draftAge: detail.draftAge,
              heightCm: detail.heightCm,
              weightKg: detail.weightKg,
              pickNote: detail.pickNote,
              detail: detail.detail,
              pickNumber: detail.pickNumber,
              clubSlug: detail.clubSlug,
            }}
            activeGroups={activeGroups}
            expectedRevision={revision}
          />
        ) : (
          <section className="section">
            <h2>Selection details</h2>
            <p>
              {detail.originalClubRaw && <>Recruited from {detail.originalClubRaw}. </>}
              {detail.heightCm && <>{detail.heightCm}cm. </>}
              {detail.weightKg && <>{detail.weightKg}kg. </>}
              {detail.draftAge && <>Age {detail.draftAge} at draft. </>}
            </p>
            {detail.pickNote && <p>{detail.pickNote}</p>}
            {detail.detail && <p className="muted">{detail.detail}</p>}
          </section>
        )
      )}

      {detail.provenance === 'manual' && (
        canEdit ? (
          <>
            <ManualPickPanel
              pickId={detail.id}
              playerId={detail.playerId}
              clubs={clubs.map((c) => ({ slug: c.slug, name: c.name }))}
              eventPairs={DRAFT_EVENT_PAIRS}
              values={{
                draftYear: detail.draftYear,
                draftType: detail.draftType,
                draftKind: detail.draftKind ?? '',
                pickNumber: detail.pickNumber,
                clubSlug: detail.clubSlug,
                playerNameRaw: detail.playerNameRaw,
                originalClubRaw: detail.originalClubRaw,
                draftAge: detail.draftAge,
                heightCm: detail.heightCm,
                weightKg: detail.weightKg,
                pickNote: detail.pickNote,
                detail: detail.detail,
              }}
              expectedRevision={revision}
            />
            {manualAwaiting && (
              <AttachIdentityPanel playerId={manualAwaiting.playerId} displayName={manualAwaiting.displayName} />
            )}
            {duplicateSourceRow && (
              <SupersedePanel
                manualPickId={detail.id}
                sourcePickId={duplicateSourceRow.id}
                sourcePlayerNameRaw={duplicateSourceRow.playerNameRaw}
              />
            )}
            <RetirePanel pickId={detail.id} expectedRevision={revision} />
          </>
        ) : (
          <section className="section">
            <h2>Selection details</h2>
            <p>
              {detail.originalClubRaw && <>Recruited from {detail.originalClubRaw}. </>}
              {detail.heightCm && <>{detail.heightCm}cm. </>}
              {detail.weightKg && <>{detail.weightKg}kg. </>}
              {detail.draftAge && <>Age {detail.draftAge} at draft. </>}
            </p>
            {detail.pickNote && <p>{detail.pickNote}</p>}
            {detail.detail && <p className="muted">{detail.detail}</p>}
          </section>
        )
      )}
    </>
  );
}
