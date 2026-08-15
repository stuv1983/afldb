# AFLW

AFLW is a separate competition in AFLDB, with its own pages under `/aflw`,
its own database schema, and no link to the AFL record. This document
covers how it is modelled and why.

Source, scrape and staging are documented separately in
[tools/aflw/README.md](../tools/aflw/README.md), which is the place to
read before touching the data itself.

## The shape of it

| Layer | What it is |
|---|---|
| `staging_aflw` | Migration 025. The aflwstats.com scrape as published, 51,018 rows |
| `aflw` | Migration 026, corrected by 027. Views over staging: the read model the site queries |
| `src/db/queries/aflw.ts` | Every AFLW query |
| `src/search/aflw-filters.ts` | The filter panel each AFLW table offers |
| `src/app/aflw/**` | Pages |

`/aflw` is laid out as the AFL front page, block for block: the same hero
and search, the same statistics strip, the same two ruled panels, the
same card grid — and the same `home.sections` setting (see
`docs/admin-and-beta.md` §2), because "the two home pages match" is only
true if one setting drives both. What differs is what the right-hand
panel can say: AFLW has no `/records` section to lead with, so it ranks
career totals off `aflw.player_careers` (`home.aflw_leaders`) instead,
and none of those categories needs a coverage caveat because every AFLW
statistic is recorded for every AFLW season.

## Why the read model is views, not tables

`seasons.year` is the season primary key on the AFL side, and AFLW played
two seasons inside calendar 2022 — Season Six from January to April and
Season Seven from August to November. Putting AFLW into the normalised
model therefore means replacing that key with a surrogate across 22
foreign keys and adding a `competitions` table: a change to the AFL model
that has not been designed, let alone tested against 694,210 player-match
rows.

Migration 026 sidesteps that entirely. The `aflw` schema is a set of plain
views over `staging_aflw` that derive what the pages need — premiers,
margins, results, career totals — without copying a row. There is no
import job, no second copy to keep in step, and a staging reload is live
immediately with no refresh, no build and no restart.

None of the views are materialized. The whole competition is 51,018 rows,
so the largest aggregate — career totals over 29,878 player-match rows —
is a sub-50ms scan. A materialized view would buy nothing and would need a
`REFRESH` that the import role does not own.

When the competition-scoping work does happen, these view definitions are
a written specification of what the pages actually need.

## Identity and URLs

Every AFLW URL is built on the source's own key:

| Entity | Key | URL |
|---|---|---|
| Season | `season_key` | `/aflw/seasons/7` |
| Club | `team_code` | `/aflw/clubs/ade` |
| Player | `player_slug` | `/aflw/players/Ebony_Marinoff` |
| Match | `match_key` | `/aflw/matches/2017-gf-brl-ade` |

Names are deliberately not used. The scrape carries no AFLW rename history
and applies current club names retroactively, so a 2017 match page already
reads Kuwarna rather than Adelaide. A URL built on a name would break at
the next rename; `ade` does not. Season keys are the source's own and are
the only stable handle, because calendar year is not unique.

`player_slug` is name-derived and is the source's only handle on a person.
Two players who share a name and were never disambiguated by the source
would share a page, and a surname change would split one career in two.
The player page says so. 960 slugs is small enough to audit by hand, and
`tools/aflw/profile_aflw.py` prints the candidates.

The staging resolution columns — `club_id`, `player_id`, `venue_id` — are
still `NULL`, and nothing in the `aflw` schema reads them. No AFLW record
is joined to an AFL one anywhere, including in search results, which are
grouped and labelled separately for that reason.

## Facts the model has to carry

**Two seasons in 2022.** `season_key` identifies a season; `ordinal`
orders them; `calendar_year` is for display only and must never identify
one. Essendon, Hawthorn, Port Adelaide and Sydney first appear in Season
Seven and never in Season Six, which confirms the two are distinct.

**2020 awarded no premiership.** The season was abandoned at the
semi-finals. `has_grand_final` is false, the premier is `NULL`, and a
ladder leader is not a premier. Nine of eleven seasons have a premier: the
other absence is 2026, still being played.

**2020 had two ladders.** Conferences A and B. `conference` is part of the
ladder key, not an attribute, and one ladder per season cannot be assumed.

**An unplayed fixture is not a nil-all draw.** The source renders one as a
0-0 draw with an empty score cell. `aflw.matches` contains played matches
only; `aflw.fixtures` carries the full published list with
`fixture_status` separating `played`, `cancelled` (two abandoned Season
Six matches) and `scheduled` (106 in 2026).

**A season is complete when nothing is still scheduled.** Season Six is
complete despite two fixtures never being played; 2026 is not. `status`
and `is_complete` are two readings of that one test, computed once.

**A venue slug comes from `aflw.venue_slug()`.** `aflw.matches` builds the
link and `aflw.venues` answers it, so the rule is a function rather than
an expression written out in each view.

**An empty scoring cell is a real zero.** For goals, behinds and score
points the source prints an empty cell rather than `0.0` for a player who
did not score, and the scoring worm confirms the absence independently.
The view reads these as `0`, which is the one place AFLDB's "NULL is not
zero" rule resolves the other way — and it does so because the source has
a second, independent record of the same fact.

**Scorer attribution stops after 2021.** The scoring progression names its
scorers for 2017–2021 and from Season Six names only the club. The match
page drops the scorer column entirely rather than printing 5,351 blanks,
and says why.

**Metres gained and fantasy points are signed.** A player can finish a
match below zero on both.

## What AFLW has that the AFL side does not

Disposals, kicks, handballs, marks, tackles, hitouts, contested
possessions, metres gained and fantasy points are recorded for **every**
AFLW season from the competition's first match. The AFL filters
deliberately exclude era-limited statistics, because filtering on
disposals would silently exclude everyone who played before they were
collected; the AFLW filters expose all of them, because there is no era to
exclude. Metres gained and the score-by-score progression have no AFL
equivalent at all.

What the source does not have: attendance, umpires, lineups beyond the
position column, player dates of birth, heights, weights, and any awards —
no best-and-fairest, Rising Star or All-Australian. These are absent, not
zero, and no page implies otherwise.

## Verification

Migration 026 was validated against the development database by creating
the schema inside a transaction, running every query the pages issue, and
rolling back. The checks that matter:

- all 12 derived season totals in `aflw.player_seasons` equal the source's
  own published season aggregates across all 3,972 player-seasons, with
  zero mismatches
- premierships reconcile: nine seasons award one, and the club totals sum
  to nine
- `aflw.venues` slugs resolve back to the same match counts they were
  derived from

Two contradictions remain in the source itself and are unresolved, both
recorded in `tools/aflw/README.md`: `2021-1-fre-gws`, where player goals
total 7–5 against a published team score of 8–4, and `2024-6-fre-haw`,
where Hawthorn's player behinds are one short of behinds minus rushed. The
read model presents the published team score, which is the figure the
source's own ladder and scoring worm agree with.
