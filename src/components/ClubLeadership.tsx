import Link from 'next/link';

import type { ClubCurrentLeadership } from '@/db/queries/club-leadership';
import { playerPath } from '@/lib/format';

/**
 * The public club page's compact current-Leadership block (AFLDB-ISSUE-163
 * §20, D-12). Rendered directly after the stat strip and before
 * `ReorderableSections` — a CURRENT fact, not a reorderable table: it must
 * be visible without scrolling, and it is never subject to the page's
 * localStorage section order.
 *
 * The caller already decided whether to fetch and render this at all
 * (continuing identity, `club.isCurrent`, a non-null query result); this
 * component only renders what it was given. No dates: those are admin
 * evidence (§20.2), not a public statement.
 */
export function ClubLeadership({ leadership }: { leadership: ClubCurrentLeadership }) {
  const { season, captains, viceCaptains } = leadership;
  if (captains.length === 0 && viceCaptains.length === 0) return null;

  const names = (leaders: ClubCurrentLeadership['captains']) => leaders.map((leader, index) => (
    <span key={leader.playerId}>
      <Link href={playerPath(leader.playerSlug, leader.playerId)}>{leader.displayName}</Link>
      {index < leaders.length - 1 ? ' · ' : ''}
    </span>
  ));

  return (
    <section className="section">
      <h2>{season} leadership</h2>
      <dl style={{ margin: 0 }}>
        {captains.length > 0 && (
          <>
            <dt style={{ fontWeight: 600 }}>{captains.length > 1 ? 'Co-captains' : 'Captain'}</dt>
            <dd style={{ margin: '0 0 0.4rem' }}>{names(captains)}</dd>
          </>
        )}
        {viceCaptains.length > 0 && (
          <>
            <dt style={{ fontWeight: 600 }}>{viceCaptains.length > 1 ? 'Vice-captains' : 'Vice-captain'}</dt>
            <dd style={{ margin: 0 }}>{names(viceCaptains)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
