import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import { getHonourTeam, listHonourTeams } from '@/db/queries/awards';
import { honourTeamPath, isLinked, playerPath, shouldShowUnmatched } from '@/lib/format';
import { notFoundMetadata, pageMetadata } from '@/lib/seo';
import { honourTeamSlug, matchHonourTeam } from '@/lib/slugs';

export const revalidate = 86400;

export async function generateStaticParams() {
  const teams = await listHonourTeams();
  return teams.map((t) => ({ slug: honourTeamSlug(t.teamName) }));
}

/** The stored team name for a URL slug, or null. */
async function resolveTeam(slug: string): Promise<string | null> {
  const teams = await listHonourTeams();
  return matchHonourTeam(slug, teams.map((t) => t.teamName));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const teamName = await resolveTeam(slug);
  if (!teamName) return notFoundMetadata('Team');

  return pageMetadata({
    title: `${teamName} — Full Team and Every Selection`,
    description: `Every player selected in the ${teamName}, with the position each filled.`,
    path: honourTeamPath(slug),
  });
}

export default async function HonourTeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const teamName = await resolveTeam(slug);
  if (!teamName) notFound();

  const members = await getHonourTeam(teamName);
  if (members.length === 0) notFound();

  const unlinked = members.filter((m) => !isLinked(m.linkStatus)).length;

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Awards', href: '/awards' },
        { label: teamName },
      ]} />

      <div className="page-header">
        <h1>{teamName}</h1>
        <p className="subtitle">{members.length} selected.</p>
      </div>

      {unlinked > 0 && (
        <p className="notice">
          {unlinked} of these selections name a player with no VFL/AFL record in AFLDB —
          several of these teams were chosen across leagues. Those names are listed as the
          source spelled them, without a link.
        </p>
      )}

      <CollapsibleTable title="Selections">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {members.some((m) => m.position) && <th scope="col">Position</th>}
              <th scope="col">Player</th>
              <th scope="col">Club</th>
              {members.some((m) => m.role) && <th scope="col">Role</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                {members.some((x) => x.position) && (
                  <td className="nowrap">{m.position ?? <span className="muted">—</span>}</td>
                )}
                <td className="wide">
                  {m.playerId && isLinked(m.linkStatus) ? (
                    <Link href={playerPath(m.playerSlug!, m.playerId)}>{m.playerName}</Link>
                  ) : (
                    <span title="No VFL/AFL record in AFLDB">{m.playerName}</span>
                  )}
                  {shouldShowUnmatched({
                    linkStatus: m.linkStatus,
                    clubName: m.clubNameRaw,
                  }) && <UnmatchedPlayer targetTable="honour_team_members" targetId={m.id} />}
                </td>
                <td>{m.clubNameRaw ?? <span className="muted">—</span>}</td>
                {members.some((x) => x.role) && (
                  <td>{m.role ?? <span className="muted">—</span>}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </CollapsibleTable>
    </>
  );
}
