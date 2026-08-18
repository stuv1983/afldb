/**
 * The seed nickname dictionaries against the real directory they merge into.
 *
 * CLUB_NICKNAMES and VENUE_NICKNAMES are `nickname -> canonical` maps,
 * and the canonical side is a LOOKUP KEY: buildClubDirectory and
 * buildVenueDirectory attach a nickname to an entity only when that
 * entity's own name-set already contains the canonical string verbatim.
 * Nothing anywhere checks that it does. A value naming something the
 * database does not call that entity attaches to nothing, and does it
 * silently -- the nickname is never a known name, and a reader using it
 * gets an unsupported term with no indication that a dictionary entry
 * was supposed to cover them.
 *
 * That failure mode shipped. `marvel` and `etihad` pointed at "docklands
 * stadium" while the venues table calls the ground "Docklands"; both
 * nicknames were dead from the day they were written, which surfaced as
 * 100 unsupported-term hits for "marvel" in one 12,000-question UI run
 * against dev. `gabba` pointed at "the gabba" against a row named
 * "Gabba", dead the same way. The entries that happened to work did so
 * because their canonical string coincided with a real database name.
 *
 * These tests make that coincidence a requirement. They are integration
 * tests rather than unit tests on purpose: the thing that drifts is the
 * relationship between a hand-maintained constant and the live data, and
 * a fixture would only re-assert the constant against itself.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { buildClubDirectory, buildVenueDirectory } from '@/db/queries/nl/resolve';
import { CLUB_NICKNAMES, VENUE_NICKNAMES } from '@/search/nl/vocab';

afterAll(async () => {
  await sql.end();
});

describe('VENUE_NICKNAMES', () => {
  it('every nickname is reachable in the built directory', async () => {
    const directory = await buildVenueDirectory();
    const known = new Set(directory.flatMap((venue) => venue.names));

    const unreachable = Object.entries(VENUE_NICKNAMES)
      .filter(([nickname]) => !known.has(nickname))
      .map(([nickname, canonical]) => `${nickname} -> ${canonical}`);

    expect(
      unreachable,
      'These nicknames merged into no venue. The canonical value must be a '
      + 'string the venues table actually holds (canonical_name, legacy_name '
      + 'or a venue_aliases row), lower-cased and verbatim.',
    ).toEqual([]);
  });

  it('no nickname resolves to more than one venue', async () => {
    // Two grounds answering to one nickname is worse than none: the
    // parser would pick whichever sorted first and silently answer about
    // the wrong ground.
    const directory = await buildVenueDirectory();
    const ambiguous: string[] = [];
    for (const nickname of Object.keys(VENUE_NICKNAMES)) {
      const owners = directory.filter((venue) => venue.names.includes(nickname));
      if (owners.length > 1) {
        ambiguous.push(`${nickname} -> ${owners.map((o) => o.name).join(', ')}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });

  it('resolves the nicknames that were silently dead before', async () => {
    // Named explicitly so a future edit that reintroduces the bug fails
    // on the case that caused it, not only on the general rule above.
    const directory = await buildVenueDirectory();
    const docklands = directory.find((v) => v.names.includes('marvel'));
    expect(docklands, '"marvel" must name a venue').toBeDefined();
    expect(docklands!.names).toEqual(expect.arrayContaining([
      'marvel', 'etihad', 'docklands', 'marvel stadium', 'etihad stadium', 'docklands stadium',
    ]));

    const gabba = directory.find((v) => v.names.includes('the gabba'));
    expect(gabba, '"the gabba" must name a venue').toBeDefined();
    expect(gabba!.names).toEqual(expect.arrayContaining(['gabba', 'the gabba']));
  });
});

describe('CLUB_NICKNAMES', () => {
  it('every nickname is reachable in the built directory', async () => {
    const directory = await buildClubDirectory();
    const known = new Set(directory.flatMap((club) => club.names));

    const unreachable = Object.entries(CLUB_NICKNAMES)
      .filter(([nickname]) => !known.has(nickname))
      .map(([nickname, canonical]) => `${nickname} -> ${canonical}`);

    expect(
      unreachable,
      'These nicknames merged into no club. The canonical value must be a '
      + 'string the clubs table actually holds (name, short_name, '
      + 'abbreviation or a club_aliases row), lower-cased and verbatim.',
    ).toEqual([]);
  });

  it('no nickname resolves to more than one organization', async () => {
    const directory = await buildClubDirectory();
    const ambiguous: string[] = [];
    for (const nickname of Object.keys(CLUB_NICKNAMES)) {
      const owners = directory.filter((club) => club.names.includes(nickname));
      if (owners.length > 1) {
        ambiguous.push(`${nickname} -> ${owners.map((o) => o.name).join(', ')}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });
});
