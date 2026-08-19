import type { Metadata } from 'next';
import Link from 'next/link';

import { CreatePlayerForm } from '@/app/admin/data-editor/CreatePlayerForm';
import { EditorForm } from '@/app/admin/data-editor/EditorForm';
import { PlayerFinder } from '@/app/admin/data-editor/PlayerFinder';
import { getSeasonMatches } from '@/db/queries/matches';
import { getEditableRow } from '@/db/queries/data-edits';
import { listDraftPicks } from '@/db/queries/draft';
import { requireSuperAdmin } from '@/lib/auth/session';
import { formatDate, formatRoundShort } from '@/lib/format';
import { firstValue, parseSeason } from '@/lib/params';
import { isEditableEntity } from '@/lib/edit/spec';

export const metadata: Metadata = { title: 'Data editor', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Manual corrections and player bio creation (see changeLog.md).
 *
 * Find or create a player, find a match, or edit draft pick details.
 * Every save is audited in data_edits; the CSV pipeline remains the
 * path for bulk jobs.
 */
export default async function DataEditorPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireSuperAdmin();
  const params = await searchParams;

  const entityParam = firstValue(params.entity) ?? '';
  const entity = isEditableEntity(entityParam) ? entityParam : null;
  const id = Number(firstValue(params.id));
  const seasonParam = parseSeason(firstValue(params.season) ?? '');
  const draftQueryParam = firstValue(params.draft_q)?.trim() ?? '';
  const draftYearParam = parseSeason(firstValue(params.draft_year) ?? '');

  const row = entity && Number.isInteger(id) && id > 0
    ? await getEditableRow(entity, id)
    : null;
  const seasonMatches = seasonParam ? await getSeasonMatches(seasonParam) : [];

  const draftResults = (draftQueryParam || draftYearParam)
    ? await listDraftPicks({
        year: draftYearParam ?? undefined,
        q: draftQueryParam || undefined,
        page: 1,
        pageSize: 50,
      })
    : null;

  return (
    <>
      <div className="page-header">
        <h1>Data editor</h1>
        <p className="subtitle">
          One-off corrections and player bio creation, saved with a note and audited. Bulk changes still go through
          the CSV upload.
        </p>
      </div>

      <section className="section" style={{ display: 'grid', gap: '1.25rem' }}>
        <div>
          <h2>Players</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <PlayerFinder />
            <CreatePlayerForm />
          </div>
        </div>

        <div>
          <h2>Matches</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'end' }}>
            <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <input type="hidden" name="entity" value="matches" />
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Match id (from its /matches/… URL)
                <input type="number" name="id" min={1} defaultValue={entity === 'matches' && id > 0 ? id : undefined} />
              </label>
              <button type="submit">Open</button>
            </form>
            <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Or browse a season
                <input type="number" name="season" min={1897} max={2100} defaultValue={seasonParam ?? undefined} />
              </label>
              <button type="submit">List matches</button>
            </form>
          </div>
        </div>

        <div>
          <h2>Draft picks</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'end' }}>
            <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <input type="hidden" name="entity" value="draft_picks" />
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Draft pick id
                <input type="number" name="id" min={1} defaultValue={entity === 'draft_picks' && id > 0 ? id : undefined} />
              </label>
              <button type="submit">Open</button>
            </form>
            <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Search draft by name
                <input
                  type="text"
                  name="draft_q"
                  placeholder="e.g. Onley or Rodriguez"
                  defaultValue={draftQueryParam}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Year
                <input
                  type="number"
                  name="draft_year"
                  min={1981}
                  max={2100}
                  placeholder="e.g. 2025"
                  defaultValue={draftYearParam ?? undefined}
                />
              </label>
              <button type="submit">Search draft</button>
            </form>
          </div>
        </div>
      </section>

      {draftResults && draftResults.rows.length > 0 && (
        <section className="section">
          <h2>Matching draft selections ({draftResults.total})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="num">ID</th>
                  <th scope="col" className="num">Year</th>
                  <th scope="col" className="num">Pick</th>
                  <th scope="col">Player name</th>
                  <th scope="col">Club</th>
                  <th scope="col">Recruited from</th>
                  <th scope="col">Status</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {draftResults.rows.map((dp) => (
                  <tr key={dp.id}>
                    <td className="num">{dp.id}</td>
                    <td className="num">{dp.draftYear}</td>
                    <td className="num">{dp.pickNumber ?? '—'}</td>
                    <td className="wide"><strong>{dp.playerNameRaw}</strong></td>
                    <td>{dp.clubName ?? dp.clubNameRaw ?? '—'}</td>
                    <td className="muted">{dp.originClub ?? '—'}</td>
                    <td><span className="badge">{dp.linkStatus}</span></td>
                    <td>
                      <Link href={`/admin/data-editor?entity=draft_picks&id=${dp.id}`}>Edit pick</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {draftResults && draftResults.rows.length === 0 && (
        <section className="section">
          <div className="empty"><h3>No draft picks found matching criteria</h3></div>
        </section>
      )}

      {seasonParam !== null && seasonMatches.length > 0 && (
        <section className="section">
          <h2>{seasonParam} matches</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">Date</th>
                  <th scope="col">Match</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {seasonMatches.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{formatRoundShort(m.roundType, m.roundNumber)}</td>
                    <td className="nowrap">{formatDate(m.matchDate)}</td>
                    <td className="wide">{m.homeName} v {m.awayName}</td>
                    <td className="num nowrap">{m.homeScore}–{m.awayScore}</td>
                    <td>
                      <Link href={`/admin/data-editor?entity=matches&id=${m.id}`}>Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {entity && id > 0 && !row && (
        <section className="section">
          <div className="empty"><h3>No {entity === 'players' ? 'player' : entity === 'draft_picks' ? 'draft pick' : 'match'} with id {id}</h3></div>
        </section>
      )}

      {row && (
        <EditorForm
          entityKey={row.entity}
          rowId={row.rowId}
          title={row.title}
          values={row.values}
        />
      )}
    </>
  );
}
