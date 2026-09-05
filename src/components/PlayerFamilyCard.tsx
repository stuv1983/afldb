import Link from 'next/link';

import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import type { PlayerFamilyResult } from '@/db/queries/players';
import { formatSelectionDetail, hasFamilyContent, relationshipLabel } from '@/lib/family-format';
import { playerPath, pluralise } from '@/lib/format';

export { hasFamilyContent };

function RelatedPersonName({
  name,
  slug,
  id,
}: {
  name: string;
  slug: string | null;
  id: number | null;
}) {
  // An unlinked relative is a real person the source names, not a fabricated
  // one -- shown as plain text rather than guessing at a profile URL.
  if (slug && id !== null) return <Link href={playerPath(slug, id)}>{name}</Link>;
  return <>{name}</>;
}

function CompareLink({ playerId, relatedId }: { playerId: number; relatedId: number | null }) {
  if (relatedId === null) return null;
  return (
    <>
      {' · '}
      <Link href={`/players/compare?a=${playerId}&b=${relatedId}`}>Compare career →</Link>
    </>
  );
}

/**
 * Family facts for a player profile (AFLDB-ISSUE-118 §23.29), phrased from
 * this player's own perspective -- a son sees "Father", a father sees the
 * sons the rule gave him. `getPlayerFamily` already excludes the
 * `player_relationships` rows the father-son loader writes from
 * `relationships`, so the same selection is never shown here twice.
 */
export function PlayerFamilyCard({
  playerId,
  family,
}: {
  playerId: number;
  family: PlayerFamilyResult;
}) {
  if (!hasFamilyContent(family)) return null;

  const count = family.fatherSonAsSon.length + family.fatherSonAsFather.length + family.relationships.length;

  return (
    <section className="section">
      <CollapsiblePanel title="Family" note={`${count} ${pluralise(count, 'relative')}`}>
        <ul className="ruled-list">
          {family.fatherSonAsSon.map((row) => (
            <li key={`son-${row.draftYear}-${row.fatherName}`}>
              <strong>Father</strong>
              {' — '}
              <RelatedPersonName name={row.fatherName} slug={row.fatherPlayerSlug} id={row.fatherPlayerId} />
              <CompareLink playerId={playerId} relatedId={row.fatherPlayerId} />
              <br />
              <span className="muted">Father-son selection — {formatSelectionDetail(row)}</span>
            </li>
          ))}

          {family.fatherSonAsFather.map((row) => (
            <li key={`father-${row.draftYear}-${row.sonName}`}>
              <strong>Son</strong>
              {' — '}
              <RelatedPersonName name={row.sonName} slug={row.sonPlayerSlug} id={row.sonPlayerId} />
              <CompareLink playerId={playerId} relatedId={row.sonPlayerId} />
              <br />
              <span className="muted">Father-son selection — {formatSelectionDetail(row)}</span>
            </li>
          ))}

          {family.relationships.map((r, i) => (
            <li key={`rel-${i}-${r.relationshipType}-${r.relatedPlayerId ?? r.relatedName}`}>
              <strong>{relationshipLabel(r.relationshipType, r.direction, r.relationshipLabel)}</strong>
              {' — '}
              <RelatedPersonName name={r.relatedName} slug={r.relatedPlayerSlug} id={r.relatedPlayerId} />
              <CompareLink playerId={playerId} relatedId={r.relatedPlayerId} />
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </section>
  );
}
