import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PlayerFamilyCard } from '@/components/PlayerFamilyCard';
import type { PlayerFamilyResult } from '@/db/queries/players';
import {
  competitionLabel,
  formatSelectionDetail,
  hasFamilyContent,
  relationshipLabel,
} from '@/lib/family-format';

function emptyFamily(): PlayerFamilyResult {
  return { relationships: [], fatherSonAsSon: [], fatherSonAsFather: [] };
}

describe('competitionLabel', () => {
  it('maps the three known father-son pathways to human labels', () => {
    expect(competitionLabel('national')).toBe('National Draft');
    expect(competitionLabel('rookie')).toBe('Rookie Draft');
    expect(competitionLabel('pre-draft')).toBe('Pre-Draft Selection');
  });

  it('passes through null and any unrecognised value rather than guessing', () => {
    expect(competitionLabel(null)).toBeNull();
    expect(competitionLabel('unexpected')).toBe('unexpected');
  });
});

describe('formatSelectionDetail', () => {
  it('includes the club, year, pathway and pick when all are present', () => {
    expect(formatSelectionDetail({
      clubName: 'Geelong',
      draftYear: 2001,
      competition: 'national',
      selectionPick: 40,
    })).toBe('Geelong · 2001 National Draft · Pick 40');
  });

  it('omits the pick cleanly rather than printing "null"', () => {
    const line = formatSelectionDetail({
      clubName: 'Geelong',
      draftYear: 2004,
      competition: 'national',
      selectionPick: null,
    });
    expect(line).toBe('Geelong · 2004 National Draft');
    expect(line).not.toContain('null');
  });

  it('falls back to the bare year when the pathway is unrecorded', () => {
    const line = formatSelectionDetail({
      clubName: null,
      draftYear: 1999,
      competition: null,
      selectionPick: null,
    });
    expect(line).toBe('1999');
    expect(line).not.toContain('null');
  });
});

describe('relationshipLabel', () => {
  it('labels a sibling row as Brother', () => {
    expect(relationshipLabel('sibling', 'from')).toBe('Brother');
    expect(relationshipLabel('sibling', 'to')).toBe('Brother');
  });

  it('labels an asymmetric relationship by direction', () => {
    expect(relationshipLabel('parent_child', 'from')).toBe('Parent');
    expect(relationshipLabel('parent_child', 'to')).toBe('Child');
  });
});

describe('hasFamilyContent', () => {
  it('is false for a player with no family records', () => {
    expect(hasFamilyContent(emptyFamily())).toBe(false);
  });

  it('is true when only a generic relationship is present', () => {
    expect(hasFamilyContent({
      ...emptyFamily(),
      relationships: [{
        relationshipType: 'sibling',
        direction: 'from',
        relatedPlayerId: null,
        relatedPlayerSlug: null,
        relatedName: 'Someone',
      }],
    })).toBe(true);
  });
});

describe('PlayerFamilyCard rendering', () => {
  it('renders a linked father and the selection detail for a son', () => {
    const family: PlayerFamilyResult = {
      ...emptyFamily(),
      fatherSonAsSon: [{
        fatherPlayerId: 100,
        fatherPlayerSlug: 'gary-ablett-sr',
        fatherName: 'Gary Ablett Sr',
        clubName: 'Geelong',
        draftYear: 2001,
        competition: 'national',
        selectionPick: 40,
      }],
    };

    const html = renderToStaticMarkup(PlayerFamilyCard({ playerId: 200, family }));
    expect(html).toContain('Father');
    expect(html).toContain('href="/players/gary-ablett-sr-100"');
    expect(html).toContain('Gary Ablett Sr');
    expect(html).toContain('Geelong · 2001 National Draft · Pick 40');
    expect(html).toContain('href="/players/compare?a=200&amp;b=100"');
  });

  it('renders every son for a father with more than one father-son selection', () => {
    const family: PlayerFamilyResult = {
      ...emptyFamily(),
      fatherSonAsFather: [
        {
          sonPlayerId: 201,
          sonPlayerSlug: 'gary-ablett-jr',
          sonName: 'Gary Ablett Jr',
          clubName: 'Geelong',
          draftYear: 2001,
          competition: 'national',
          selectionPick: 40,
        },
        {
          sonPlayerId: 202,
          sonPlayerSlug: 'nathan-ablett',
          sonName: 'Nathan Ablett',
          clubName: 'Geelong',
          draftYear: 2004,
          competition: 'national',
          selectionPick: null,
        },
      ],
    };

    const html = renderToStaticMarkup(PlayerFamilyCard({ playerId: 100, family }));
    expect(html).toContain('Gary Ablett Jr');
    expect(html).toContain('href="/players/compare?a=100&amp;b=201"');
    expect(html).toContain('Geelong · 2001 National Draft · Pick 40');
    expect(html).toContain('Nathan Ablett');
    expect(html).toContain('href="/players/compare?a=100&amp;b=202"');
    expect(html).toContain('Geelong · 2004 National Draft');
    // Each son gets its own label rather than a shared pluralised header --
    // that keeps the markup identical regardless of how many sons a father has.
    expect(html.match(/<strong>Son<\/strong>/g)).toHaveLength(2);
  });

  it('shows an unlinked relative as plain text without a fabricated URL', () => {
    const family: PlayerFamilyResult = {
      ...emptyFamily(),
      fatherSonAsSon: [{
        fatherPlayerId: null,
        fatherPlayerSlug: null,
        fatherName: 'Unknown (W.G., Mayne)',
        clubName: 'Brisbane Lions',
        draftYear: 1999,
        competition: 'pre-draft',
        selectionPick: null,
      }],
    };

    const html = renderToStaticMarkup(PlayerFamilyCard({ playerId: 300, family }));
    expect(html).toContain('Unknown (W.G., Mayne)');
    expect(html).not.toContain('<a');
  });

  it('renders a linked generic relationship with a compare link', () => {
    const family: PlayerFamilyResult = {
      ...emptyFamily(),
      relationships: [{
        relationshipType: 'sibling',
        direction: 'from',
        relatedPlayerId: 400,
        relatedPlayerSlug: 'jack-example',
        relatedName: 'Jack Example',
      }],
    };

    const html = renderToStaticMarkup(PlayerFamilyCard({ playerId: 300, family }));
    expect(html).toContain('Brother');
    expect(html).toContain('href="/players/jack-example-400"');
    expect(html).toContain('href="/players/compare?a=300&amp;b=400"');
  });

  it('renders multiple generic relationships, linked and unlinked, without special-casing', () => {
    const family: PlayerFamilyResult = {
      ...emptyFamily(),
      relationships: [
        {
          relationshipType: 'sibling',
          direction: 'from',
          relatedPlayerId: 401,
          relatedPlayerSlug: 'jack-example',
          relatedName: 'Jack Example',
        },
        {
          relationshipType: 'sibling',
          direction: 'from',
          relatedPlayerId: null,
          relatedPlayerSlug: null,
          relatedName: 'Unlinked Example',
        },
      ],
    };

    const html = renderToStaticMarkup(PlayerFamilyCard({ playerId: 300, family }));
    expect(html.match(/>Brother</g)).toHaveLength(2);
    expect(html).toContain('href="/players/jack-example-401"');
    expect(html).toContain('href="/players/compare?a=300&amp;b=401"');
    expect(html).toContain('Unlinked Example');
    // The unlinked relative is plain text and gets no compare link either.
    expect(html).not.toContain('href="/players/compare?a=300&amp;b=null"');
  });

  it('renders nothing for a player with no canonical family data', () => {
    const node = PlayerFamilyCard({ playerId: 1, family: emptyFamily() });
    expect(node).toBeNull();
  });
});
