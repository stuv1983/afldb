import Link from 'next/link';

import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import type { PlayerAfterSirenEvent } from '@/db/queries/after-siren';
import { afterSirenEventLabel } from '@/lib/after-siren-format';
import { clubPath, matchPath, pluralise } from '@/lib/format';

function ClubLink({ name, slug }: { name: string; slug: string | null }) {
  if (slug) return <Link href={clubPath(slug)}>{name}</Link>;
  return <>{name}</>;
}

/**
 * A player's after-the-siren kicks (AFLDB-ISSUE-118 §W.4), collapsed by
 * default -- like Coaching Career, contextual rather than the primary
 * record a reader comes to a profile for. Renders nothing when the player
 * has none, so an empty section never appears in `ReorderableSections`.
 */
export function PlayerAfterSirenEvents({ events }: { events: PlayerAfterSirenEvent[] }) {
  if (events.length === 0) return null;

  return (
    <section className="section">
      <CollapsiblePanel
        title="After-the-siren"
        note={`${events.length} ${pluralise(events.length, 'event')}`}
        defaultOpen={false}
      >
        <ul className="ruled-list">
          {events.map((e) => (
            <li key={e.id}>
              <strong>{afterSirenEventLabel(e)}</strong>
              {' — '}
              Round {e.roundRaw}, {e.season}
              {' · '}
              <ClubLink name={e.clubName} slug={e.clubSlug} /> v{' '}
              <ClubLink name={e.opponentName} slug={e.opponentSlug} />
              {' · '}
              {e.matchId ? (
                <Link href={matchPath(e.matchId)}>{e.kickerScoreRaw}–{e.opponentScoreRaw}</Link>
              ) : (
                <span>{e.kickerScoreRaw}–{e.opponentScoreRaw}</span>
              )}
              {!e.premiershipSeason && <span className="muted"> · {e.competition}</span>}
              {!e.cited && <span className="badge badge-warn"> uncited</span>}
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </section>
  );
}
