import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddPlayerPanel } from '@/app/admin/season-lists/AddPlayerPanel';
import { AppearancesReviewPanel } from '@/app/admin/season-lists/AppearancesReviewPanel';
import { DraftSuggestionsPanel } from '@/app/admin/season-lists/DraftSuggestionsPanel';
import { LeadershipPanel } from '@/app/admin/season-lists/LeadershipPanel';
import { LEADERSHIP_ROLE_LABELS } from '@/app/admin/season-lists/leadership-labels';
import { MemberActions } from '@/app/admin/season-lists/MemberActions';
import { sql } from '@/db/client';
import { readClubSeasonLeadership } from '@/db/queries/admin-club-leadership';
import {
  administrableListSeasons,
  eligibleClubsForSeason,
  FIRST_LIST_SEASON,
  isAdministrableListSeason,
  readAppearanceReviewCandidates,
  readClubSeasonList,
  readDepartedSincePreviousList,
  readDraftSuggestions,
  readPlayedNotListed,
} from '@/db/queries/admin-season-lists';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ season: string; club: string }> },
): Promise<Metadata> {
  await requireCapability('data.seasonLists.read');
  const { season, club } = await params;
  return { title: `${season} · ${club}`, robots: { index: false, follow: false } };
}

const FILTERS = ['all', 'draftees', 'unresolved', 'no-games'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  draftees: 'Draftees',
  unresolved: 'Awaiting identity',
  'no-games': 'No games recorded',
};

const ORIGIN_LABELS: Record<string, string> = {
  added: 'Added',
  copied_list: 'Copied forward',
  transferred: 'Transferred',
  imported: 'Imported',
};

/**
 * `/admin/season-lists/[season]/[club]` — the primary operational surface
 * (AFLDB-ISSUE-161 §12, §13, §14, §20, §23). Lists every member whether or
 * not they have played (§9.4, §12.1): membership records administrative
 * intent, never participation, so a zero-game listed player is shown
 * exactly like any other, never hidden.
 *
 * Admin (`data.seasonLists.read`) sees the whole page read-only; Super Admin
 * (`data.seasonLists.edit`) additionally sees Add / Remove / Transfer / the
 * draftee and appearances-review panels.
 */
export default async function SeasonListClubPage(
  { params, searchParams }: {
    params: Promise<{ season: string; club: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const admin = await requireCapability('data.seasonLists.read');
  const { season: seasonParam, club: clubSlug } = await params;
  const search = await searchParams;
  const season = Number(seasonParam);
  if (!Number.isInteger(season)) notFound();

  const bounds = await administrableListSeasons();
  if (!isAdministrableListSeason(season, bounds)) notFound();

  // §9.1: eligibility needs no fixture, no matches and no club_seasons row
  // for a future season (§9.4) — this resolves against clubs + the season
  // register alone.
  const eligible = await eligibleClubsForSeason(season);
  const club = eligible.find((candidate) => candidate.slug === clubSlug);
  if (!club) notFound();

  const canEdit = hasCapability(admin, 'data.seasonLists.edit');
  const rawFilter = firstValue(search.filter) ?? 'all';
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter) ? (rawFilter as Filter) : 'all';

  const members = await readClubSeasonList(season, clubSlug);
  const filtered = members.filter((member) => {
    if (filter === 'draftees') return member.draftPickId !== null;
    if (filter === 'unresolved') return member.awaitingIdentity;
    if (filter === 'no-games') return member.gamesInSeason === 0;
    return true;
  });

  const isFirstSeason = season === FIRST_LIST_SEASON;
  const [playedNotListed, appearances, draftees, departed, leadership] = await Promise.all([
    readPlayedNotListed(season, clubSlug),
    isFirstSeason ? readAppearanceReviewCandidates(season, clubSlug) : Promise.resolve([]),
    canEdit ? readDraftSuggestions(season, clubSlug) : Promise.resolve([]),
    // §15.1 / §13's "departed since S-1" panel reference. Only meaningful
    // against an earlier AUTHORITATIVE list -- for 2027 the appearances
    // review panel below already shows this exact set, clearly labelled.
    isFirstSeason ? Promise.resolve([]) : readDepartedSincePreviousList(season, clubSlug),
    // AFLDB-ISSUE-163 §17: every appointment for this club-season, active,
    // ended and void, already ordered current-first.
    readClubSeasonLeadership(season, clubSlug),
  ]);

  // The Appoint/Replace candidate pool is exactly this club-season's own
  // list membership (§9, L-8, L-11) -- never the global player picker.
  const leadershipCandidates = members.map((member) => ({
    playerId: member.playerId,
    displayName: member.displayName,
    activeLeadershipRole: member.activeLeadershipRole,
  }));

  // The ISSUE-160 handoff (§14): `?add=<playerId>` pre-fills the Add panel;
  // the add itself is still an explicit Super Admin confirmation below.
  const addPreset = firstValue(search.add);
  const presetPlayerId = addPreset ? Number(addPreset) : null;
  const presetPlayer = presetPlayerId && Number.isInteger(presetPlayerId)
    ? (await sql<{ id: number; displayName: string }[]>`
        SELECT id, display_name AS "displayName" FROM players WHERE id = ${presetPlayerId}
      `)[0] ?? null
    : null;

  const hrefWith = (overrides: Record<string, string | undefined>): string => {
    const merged: Record<string, string | undefined> = { filter: filter === 'all' ? undefined : filter, ...overrides };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    const qs = query.toString();
    return qs ? `/admin/season-lists/${season}/${clubSlug}?${qs}` : `/admin/season-lists/${season}/${clubSlug}`;
  };

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href={`/admin/season-lists/${season}`}>← {season} season list</Link></p>
        <h1>{club.name} — {season}</h1>
        <p className="subtitle">
          {members.length} listed player{members.length === 1 ? '' : 's'}. A list membership records
          administrative intent, not participation — a listed player with no games yet is a normal
          state, never an error.
        </p>
      </div>

      <section className="section" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        {FILTERS.map((value) => (
          <Link
            key={value}
            href={hrefWith({ filter: value === 'all' ? undefined : value })}
            className={value === filter ? 'btn btn-primary' : 'btn btn-secondary'}
          >
            {FILTER_LABELS[value]}
          </Link>
        ))}
      </section>

      <section className="section">
        <div className="table-wrap">
          <table className="sticky-last-col">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Origin</th>
                <th scope="col" className="num">Games in {season}</th>
                <th scope="col">Note</th>
                {canEdit && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.membershipId}>
                  <td>
                    <a href={playerPath(member.playerSlug, member.playerId)}>{member.displayName}</a>
                    {member.draftPickId !== null && <> <span className="badge">Draftee</span></>}
                    {member.awaitingIdentity && <> <span className="badge">Awaiting AFL Tables identity</span></>}
                    {member.activeLeadershipRole && (
                      <> <span className="badge">{LEADERSHIP_ROLE_LABELS[member.activeLeadershipRole]}</span></>
                    )}
                  </td>
                  <td>
                    {ORIGIN_LABELS[member.origin] ?? member.origin}
                    {member.origin === 'copied_list' && member.copiedFromSeason !== null && (
                      <span className="muted"> (from {member.copiedFromSeason})</span>
                    )}
                  </td>
                  <td className="num">
                    {member.gamesInSeason === null ? 'No matches recorded' : member.gamesInSeason}
                  </td>
                  <td className="wide">{member.note ?? '—'}</td>
                  {canEdit && (
                    <td>
                      <MemberActions
                        season={season}
                        membershipId={member.membershipId}
                        playerName={member.displayName}
                        currentClubSlug={member.clubSlug}
                        expectedUpdatedAt={member.updatedAt}
                        eligibleClubs={eligible.map((c) => ({ slug: c.slug, name: c.name }))}
                        activeLeadershipRole={member.activeLeadershipRole}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 5 : 4} className="muted">No players match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <LeadershipPanel
        season={season}
        clubSlug={clubSlug}
        canEdit={canEdit}
        rows={leadership}
        members={leadershipCandidates}
      />

      {playedNotListed.length > 0 && (
        <section className="section">
          <h2>Played but not listed</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            These players recorded a game for {club.name} in {season} but hold no {season} list
            membership — a likely list error once {season}&rsquo;s lists are complete (§15.1).
          </p>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
            {playedNotListed.map((player) => (
              <li key={player.playerId}>
                <a href={playerPath(player.playerSlug, player.playerId)}>{player.displayName}</a>
                {' — '}{player.games} game{player.games === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {departed.length > 0 && (
        <section className="section">
          <h2>Departed since {season - 1}</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            On {club.name}&rsquo;s (or its organisation&rsquo;s) {season - 1} list and not on the{' '}
            {season} list — retired, delisted, or listed elsewhere this season (§15.1). Nothing here
            implies retirement globally: a player who returns is simply listed again in a later
            season.
          </p>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
            {departed.map((player) => (
              <li key={player.playerId}>
                <a href={playerPath(player.playerSlug, player.playerId)}>{player.displayName}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <AddPlayerPanel
          season={season}
          clubSlug={clubSlug}
          initialSelected={presetPlayer ? { id: presetPlayer.id, label: presetPlayer.displayName } : null}
        />
      )}

      {canEdit && draftees.length > 0 && (
        <DraftSuggestionsPanel season={season} clubSlug={clubSlug} candidates={draftees} />
      )}

      {canEdit && isFirstSeason && (
        <AppearancesReviewPanel season={season} clubSlug={clubSlug} candidates={appearances} />
      )}
    </>
  );
}
