import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClubsPanel } from '@/app/admin/fixtures/ClubsPanel';
import { roundHeading, FIXTURE_STATUS_LABELS, PLAYED_STATE_LABELS } from '@/app/admin/fixtures/labels';
import { LifecyclePanel } from '@/app/admin/fixtures/LifecyclePanel';
import { NotesPanel } from '@/app/admin/fixtures/NotesPanel';
import { ReschedulePanel } from '@/app/admin/fixtures/ReschedulePanel';
import { RoundPanel } from '@/app/admin/fixtures/RoundPanel';
import { VenuePanel } from '@/app/admin/fixtures/VenuePanel';
import { eligibleFixtureClubs, isPlayedState, readFixture } from '@/db/queries/admin-fixtures';
import { listVenues } from '@/db/queries/venues';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatDate, matchPath } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ season: string; fixtureKey: string }> },
): Promise<Metadata> {
  await requireCapability('data.fixtures.read');
  const { fixtureKey } = await params;
  const fixture = await readFixture(fixtureKey);
  return {
    title: fixture ? `${fixture.homeClubName} v ${fixture.awayClubName}` : 'Fixture',
    robots: { index: false, follow: false },
  };
}

/**
 * `/admin/fixtures/[season]/[fixtureKey]` — the fixture detail/edit surface
 * (AFLDB-ISSUE-162 §28). Identity, provenance and the played resolution
 * render read-only above the mutation panels; Admin sees every fact with no
 * editing controls, Super Admin sees the panel set §15 admits for this
 * fixture's current state, and none the backend forbids.
 *
 * A played fixture (§18) shows only Notes: hiding the other panels is a
 * convenience, not the boundary — every action still asserts
 * `data.fixtures.edit` and the backend still refuses `played_locked` on its
 * own account (§15's `isFixtureEditAllowed`).
 */
export default async function FixtureDetailPage(
  { params }: { params: Promise<{ season: string; fixtureKey: string }> },
) {
  const admin = await requireCapability('data.fixtures.read');
  const { season: seasonParam, fixtureKey } = await params;
  const season = Number(seasonParam);
  if (!Number.isInteger(season)) notFound();

  const fixture = await readFixture(fixtureKey);
  if (!fixture || fixture.season !== season) notFound();

  const canEdit = hasCapability(admin, 'data.fixtures.edit');
  const played = isPlayedState(fixture.playedState);
  // A void row is terminal and accepts `fixture_notes` and nothing else
  // (§16, §37.8 item 8), exactly as a played one does. `isFixtureEditAllowed()`
  // refuses every other field group for it, so rendering the schedule, venue,
  // round and club panels there would offer four controls that can only ever
  // fail. Hiding them is a convenience, never the boundary: the backend gate
  // is unchanged and still refuses a forged request against any of them.
  const schedulable = !played && fixture.status !== 'void';

  // Fetched unconditionally: both reads are cheap, and keeping one code path
  // avoids a ternary that would otherwise need to unify two differently-typed
  // branches. Unused (never rendered) when the viewer cannot edit.
  const [clubs, venues] = await Promise.all([eligibleFixtureClubs(season), listVenues()]);

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href={`/admin/fixtures/${season}`}>← {season} fixtures</Link></p>
        <h1>{fixture.homeClubName} v {fixture.awayClubName}</h1>
        <p className="subtitle">
          {season} · {roundHeading(fixture)} · {FIXTURE_STATUS_LABELS[fixture.status]}
          {' · '}<Link href={`/admin/audit/entity/fixtures/${fixture.id}`}>Audit trail</Link>
        </p>
      </div>

      <section className="section">
        <h2>Schedule &amp; identity</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Date</th>
                <td>{fixture.matchDate ? formatDate(fixture.matchDate) : 'TBC'}</td>
                <th scope="row">Local start time</th>
                <td>{fixture.matchTime ?? 'TBC'}</td>
              </tr>
              <tr>
                <th scope="row">Venue</th>
                <td>
                  {fixture.venueId !== null
                    ? fixture.venueRaw
                    : fixture.venueRaw !== null
                      ? <>{fixture.venueRaw} <span className="badge">Unmapped</span></>
                      : 'TBC'}
                </td>
                <th scope="row">Status</th>
                <td>
                  {FIXTURE_STATUS_LABELS[fixture.status]}
                  {fixture.statusReason && <span className="muted"> — {fixture.statusReason}</span>}
                </td>
              </tr>
              <tr>
                <th scope="row">Played</th>
                <td colSpan={3}>
                  <span className={
                    fixture.playedState === 'ambiguous' ? 'badge badge-danger'
                      : fixture.playedState === 'played_home_away_differs' ? 'badge badge-warn' : undefined
                  }>
                    {PLAYED_STATE_LABELS[fixture.playedState]}
                  </span>
                  {played && fixture.playedMatchId !== null && (
                    <> · <a href={matchPath(fixture.playedMatchId)}>View the match →</a></>
                  )}
                  {fixture.playedState === 'played_home_away_differs' && (
                    <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                      The played match has home and away the other way round from this fixture.
                    </p>
                  )}
                  {fixture.playedState === 'ambiguous' && (
                    <p className="notice" role="alert" style={{ margin: '0.3rem 0 0' }}>
                      More than one played match could be this fixture, so AFLDB has deliberately
                      linked nothing. Correct the round or the clubs on one of the candidate
                      matches, then reload this page.
                    </p>
                  )}
                  {fixture.scheduleDiffersFromResult && (
                    <p className="notice" role="alert" style={{ margin: '0.3rem 0 0' }}>
                      The played match disagrees with this fixture on its date, time or venue. The
                      result is authoritative for what happened; this fixture records what was
                      scheduled.
                    </p>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Created</th>
                <td>{formatDate(fixture.createdAt)}</td>
                <th scope="row">Updated</th>
                <td>{formatDate(fixture.updatedAt)}</td>
              </tr>
              <tr>
                <th scope="row">Fixture key</th>
                <td colSpan={3} style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem' }}>{fixture.fixtureKey}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {canEdit && schedulable && (
        <ReschedulePanel fixtureKey={fixture.fixtureKey} matchDate={fixture.matchDate} matchTime={fixture.matchTime} expectedUpdatedAt={fixture.updatedAt} />
      )}
      {canEdit && schedulable && (
        <VenuePanel fixtureKey={fixture.fixtureKey} venueId={fixture.venueId} venueRaw={fixture.venueRaw} venues={venues.map((v) => ({ id: v.id, canonicalName: v.canonicalName }))} expectedUpdatedAt={fixture.updatedAt} />
      )}
      {canEdit && schedulable && (
        <RoundPanel fixtureKey={fixture.fixtureKey} roundType={fixture.roundType} roundNumber={fixture.roundNumber} expectedUpdatedAt={fixture.updatedAt} />
      )}
      {canEdit && schedulable && (
        <ClubsPanel
          fixtureKey={fixture.fixtureKey}
          homeClubId={fixture.homeClubId}
          homeClubName={fixture.homeClubName}
          awayClubId={fixture.awayClubId}
          awayClubName={fixture.awayClubName}
          clubs={clubs.map((c) => ({ id: c.id, name: c.name }))}
          expectedUpdatedAt={fixture.updatedAt}
        />
      )}

      {canEdit && (
        <NotesPanel fixtureKey={fixture.fixtureKey} notes={fixture.notes} expectedUpdatedAt={fixture.updatedAt} />
      )}
      {!canEdit && fixture.notes && (
        <section className="section">
          <h2>Notes</h2>
          <p>{fixture.notes}</p>
        </section>
      )}

      {canEdit && !played && (
        <LifecyclePanel fixtureKey={fixture.fixtureKey} status={fixture.status} expectedUpdatedAt={fixture.updatedAt} />
      )}
      {/* An editor is told this by LifecyclePanel's own terminal branch; this
          is the same fact for a read-only Admin, who never sees that panel. */}
      {!canEdit && !played && fixture.status === 'void' && (
        <section className="section">
          <p className="muted">
            This fixture was voided as a data-entry error. It is kept so its audit trail and
            durable record stay resolvable, but it is not maintained — only its notes may still be
            changed.
          </p>
        </section>
      )}
      {played && (
        <section className="section">
          <p className="muted">
            This fixture has been played. The result is authoritative for what happened, so only
            its notes may be changed here — correcting a played match&rsquo;s own identity, round,
            date or clubs is match administration, not fixture administration.
          </p>
        </section>
      )}
    </>
  );
}
