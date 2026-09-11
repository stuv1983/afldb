import type { Metadata } from 'next';
import Link from 'next/link';

import { AwardWinnerForm } from '@/app/admin/data-editor/AwardWinnerForm';
import { CreateMatchForm } from '@/app/admin/data-editor/CreateMatchForm';
import { CreatePlayerForm } from '@/app/admin/data-editor/CreatePlayerForm';
import { EditorForm } from '@/app/admin/data-editor/EditorForm';
import { HallOfFameForm } from '@/app/admin/data-editor/HallOfFameForm';
import { HonourTeamForm } from '@/app/admin/data-editor/HonourTeamForm';
import { MatchSheetEditor } from '@/app/admin/data-editor/MatchSheetEditor';
import { PlayerFinder } from '@/app/admin/data-editor/PlayerFinder';
import { listAwards, listHonourTeams } from '@/db/queries/awards';
import { listClubs } from '@/db/queries/clubs';
import { listVenues } from '@/db/queries/venues';
import { getMatch, getMatchPlayers, getRecentClubLineup } from '@/db/queries/matches';
import { getEditableRow } from '@/db/queries/data-edits';
import { searchAdminMatches } from '@/db/queries/match-admin';
import { listSeasons } from '@/db/queries/seasons';
import { requireCapability } from '@/lib/auth/session';
import { formatDate, formatRoundShort } from '@/lib/format';
import { firstValue, parseSeason } from '@/lib/params';
import { isEditableEntity } from '@/lib/edit/spec';
import { MatchBrowser } from '@/app/admin/data-editor/MatchBrowser';

export const metadata: Metadata = { title: 'Data editor', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Manual corrections, player bio creation, match creation & sheet editing, and awards/honours management (see changeLog.md).
 *
 * Find or create a player, find or create a match, edit match player statistics, or record award
 * winners and representative team selections. Draft selections moved to `/admin/draft`
 * (AFLDB-ISSUE-160 D-5) -- this page refuses them rather than editing them.
 * Every save is audited in data_edits; the CSV pipeline remains the path for bulk jobs.
 */
export default async function DataEditorPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireCapability('data.dataEditor');
  const params = await searchParams;

  const mode = firstValue(params.mode) ?? '';
  const entityParam = firstValue(params.entity) ?? '';
  const entity = isEditableEntity(entityParam) ? entityParam : null;
  const id = Number(firstValue(params.id));
  const seasonParam = parseSeason(firstValue(params.season) ?? '');
  const clubIdParam = Number(firstValue(params.club_id)) || null;
  const roundParam = Number(firstValue(params.round)) || null;
  const matchQueryParam = firstValue(params.match_q)?.trim() ?? '';

  const [clubs, venues, awards, honourTeams, seasonsList] = await Promise.all([
    listClubs(),
    listVenues(),
    listAwards(),
    listHonourTeams(),
    listSeasons(),
  ]);
  const existingTeamNames = honourTeams.map((t) => t.teamName);

  const matchForSheet = (mode === 'match-sheet' && Number.isInteger(id) && id > 0)
    ? await getMatch(id)
    : null;
  const matchSheetPlayers = matchForSheet ? await getMatchPlayers(id) : [];

  const [homeRecentLineup, awayRecentLineup] = matchForSheet
      ? await Promise.all([
        getRecentClubLineup(matchForSheet.homeClubId, matchForSheet.id),
        getRecentClubLineup(matchForSheet.awayClubId, matchForSheet.id),
      ])
    : [[], []];

  const row = (mode !== 'match-sheet' && entity && Number.isInteger(id) && id > 0)
    ? await getEditableRow(entity, id)
    : null;

  const adminMatchesResult = (!matchForSheet && !row && entity !== 'draft_picks')
    ? await searchAdminMatches({
        season: seasonParam,
        clubId: clubIdParam,
        roundNumber: roundParam,
        query: matchQueryParam,
        limit: 35,
      })
    : { rows: [], total: 0 };

  return (
    <>
      <div className="page-header">
        <h1>Data editor</h1>
        <p className="subtitle">
          One-off corrections, player creation, match creation & sheets, and awards management, saved with a note and audited.
        </p>
      </div>

      <section className="section" style={{ display: 'grid', gap: '1.5rem' }}>
        <div>
          <h2>Players & recruitment</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <PlayerFinder />
            <CreatePlayerForm />
          </div>
        </div>

        <div>
          <h2>Awards, Hall of Fame & Representative Teams</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <AwardWinnerForm awards={awards} clubs={clubs} />
            <HallOfFameForm clubs={clubs} />
            <HonourTeamForm existingTeams={existingTeamNames} clubs={clubs} />
          </div>
        </div>

        <div>
          <h2>Matches</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'end', marginBottom: '0.75rem' }}>
            <CreateMatchForm clubs={clubs} venues={venues} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'end' }}>
            <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <input type="hidden" name="entity" value="matches" />
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Jump to match details (scores/venue)
                <input type="number" name="id" min={1} placeholder="Match ID" defaultValue={mode !== 'match-sheet' && entity === 'matches' && id > 0 ? id : undefined} />
              </label>
              <button type="submit">Open details</button>
            </form>
            <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <input type="hidden" name="mode" value="match-sheet" />
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                Jump to match sheet (lineup & player stats)
                <input type="number" name="id" min={1} placeholder="Match ID" defaultValue={mode === 'match-sheet' && id > 0 ? id : undefined} />
              </label>
              <button type="submit" className="btn btn-primary">Open match sheet</button>
            </form>
          </div>
        </div>

        <div>
          <h2>Draft picks</h2>
          <p className="muted">
            Draft selections and new-player-through-draft intake moved to their own surface
            (AFLDB-ISSUE-160): <Link href="/admin/draft">Draft administration</Link>. This page no
            longer edits them.
          </p>
        </div>
      </section>

      {!matchForSheet && !row && entity !== 'draft_picks' && (
        <MatchBrowser
          matches={adminMatchesResult.rows}
          total={adminMatchesResult.total}
          clubs={clubs}
          seasons={seasonsList}
          currentSeason={seasonParam}
          currentClubId={clubIdParam}
          currentRound={roundParam}
          currentQuery={matchQueryParam}
        />
      )}

      {matchForSheet && (
        <MatchSheetEditor
          match={matchForSheet}
          initialPlayers={matchSheetPlayers}
          homeRecentLineup={homeRecentLineup}
          awayRecentLineup={awayRecentLineup}
        />
      )}

      {mode === 'match-sheet' && id > 0 && !matchForSheet && (
        <section className="section">
          <div className="empty"><h3>No match with id #{id} found</h3></div>
        </section>
      )}

      {mode !== 'match-sheet' && entity === 'draft_picks' && id > 0 && (
        <section className="section">
          <div className="empty">
            <h3>Draft selections are edited in Draft administration</h3>
            <p><Link href={`/admin/draft/${id}`}>Open selection #{id} in Draft administration</Link></p>
          </div>
        </section>
      )}

      {mode !== 'match-sheet' && entity && entity !== 'draft_picks' && id > 0 && !row && (
        <section className="section">
          <div className="empty"><h3>No {entity === 'players' ? 'player' : 'match'} with id {id}</h3></div>
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
