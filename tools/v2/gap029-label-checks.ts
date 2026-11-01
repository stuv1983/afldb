/** V2-GAP-029: the pure identity check shared by the reviewed production label tool and its unit tests.
 *
 * No database, no `server-only`, no I/O: a live `matches` row is compared with its evidence entry and the first
 * mismatch is named. Every identity field the evidence records is compared, `venueRaw` included, and NULL keeps its
 * meaning: an evidence NULL matches only a live NULL, and a live NULL never matches an evidenced venue. An evidence
 * entry that omits `venueRaw` (undefined) is malformed and refuses rather than being read as NULL. (The live column is
 * NOT NULL, so a live NULL cannot occur today; the check stays defensive so a schema change cannot loosen it.)
 */
export interface Entry {
  family: string; label: string; year: number; matchId: number;
  expect: { season: number; matchDate: string; roundCode: string; venueRaw: string | null; homeClub: string; awayClub: string; homeScore: number; awayScore: number };
}
export interface Row { id: number; season: number; match_date: string; round_code: string; venue_raw: string | null; hn: string; an: string; hs: number; aws: number; match_event: string | null }

/** Returns null when the label may be (or already is) applied; otherwise the reason the row is refused. */
export function entryProblem(e: Entry, r: Row | undefined): string | null {
  if (!r) return `match ${e.matchId} not found`;
  const x = e.expect;
  if (!(r.season === x.season && r.match_date === x.matchDate && r.round_code === x.roundCode && r.venue_raw === x.venueRaw
    && r.hn === x.homeClub && r.an === x.awayClub && r.hs === x.homeScore && r.aws === x.awayScore)) {
    return `match ${e.matchId} no longer has the expected identity`;
  }
  if (r.match_event !== null && r.match_event !== e.label) return `match ${e.matchId} already carries a different event`;
  return null;
}
