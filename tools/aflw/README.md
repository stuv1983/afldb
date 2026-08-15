# AFLW ingestion — parse and stage

Turns the aflwstats.com scrape in `D:/dev/aflw/raw/raw` into flat files and
a staging schema, so the real data can be inspected before any decision is
made about the normalised model.

```
python tools/aflw/parse_aflw.py            # HTML -> data/aflw/parsed/*.csv
python tools/aflw/profile_aflw.py          # reconcile and describe
python tools/aflw/load_staging.py --check  # validate against the schema, no database
npm run db:migrate                         # create staging_aflw (migration 025)
python tools/aflw/load_staging.py --load   # TRUNCATE + COPY
```

The schema is `src/db/migrations/025_staging_aflw.sql`, applied like any
other migration. `load_staging.py` only ever loads rows; it never creates a
table or issues a grant. `--load` always runs `--check` first, so a bad parse
is reported as a readable list rather than a `COPY` failure halfway through.

Nothing here resolves an entity. Team codes, player slugs and venue strings
are staged exactly as published, with the resolution columns left NULL for a
later pass. `data/` is gitignored, so the parsed files are rebuildable
artefacts, never inputs — the parse runs on the workstation where the scrape
lives, and only the CSVs travel to the server.

## What the source is

757 pages covering 2017–2026: 710 match pages, 11 season pages (ladders and
the full fixture list), 11 season player pages, plus leading-goalkicker and
squad-experience pages that are derived and therefore not staged.

The parser reports two issues over the whole corpus, both real: the two
Season Six fixtures that were never played.

## Things about this source that will bite

**Two seasons share calendar 2022.** Season Six ran 7 January to 9 April
2022 (75 matches); Season Seven ran 25 August to 27 November 2022 (99
matches). The source keys them `2022` and `7`. Any model keyed on year
loses one of them. Independent confirmation: Essendon, Hawthorn, Port
Adelaide and Sydney first appear in `7`, never in `2022`.

**An unplayed fixture renders as a 0-0 draw.** The cell carries
`class="Draw"` and `data-value="0"` with no content. Reading `data-value`
turns all 106 scheduled 2026 fixtures and both abandoned Season Six matches
into real draws. A fixture is played only when the score cell contains score
spans *and* a match-stats link exists; the parser cross-checks the two
signals and reports any disagreement.

**Unplayed does not mean future.** `fixture_status` separates `cancelled`
(scheduled before the season's last played match) from `scheduled` (after
it). The rule is positional rather than based on today's date, so a re-parse
of the same scrape always yields the same answer.

**2020 had two ladders.** Conferences A and B, and no premier — the season
was abandoned at the semi-finals. Season completion and premiership award
are separate facts, and one ladder per season cannot be assumed.

**Club names are current labels applied retroactively.** A 2017 match page
already says Kuwarna, not Adelaide. The scrape carries no AFLW rename
history at all; that has to come from elsewhere.

**The player slug is the only handle on a person**, and it is name-derived.
The source disambiguates same-named players inconsistently
(`Jordyn_Allen`/`Jordyn_Allen1`, but `Ella_Smith0`/`Ella_Smith1` with no
unsuffixed form). A collision it failed to notice, or a surname change
splitting one career in two, would both pass silently. 960 slugs is small
enough to audit by hand, and `profile_aflw.py` prints the candidates.

**Scorer attribution stops after 2021.** The scoring worm names its scorers
in full for 2017–2020, for 32 of 68 matches in 2021, and never afterwards —
from Season Six on it names only the club. Attribution is all-or-nothing per
match, never partial.

**Two statistics are signed.** Metres gained reaches -52 and fantasy points
-5 in real rows. A non-negative CHECK would reject them.

**Position vocabulary changed in 2020.** 2017–2019 use `BPR`/`FPL`; 2020
onward use `WL`/`WR`. 19 codes in total, 21 players per team sheet (22 in
2017).

## What reconciles

Run `profile_aflw.py` for the full report. Across 710 matches, 29,878
player-match rows and 15,483 scoring events:

- every played fixture has a match page and vice versa; scores, teams,
  venues and dates agree between them
- `goals*6 + behinds = score` for every team in every match
- the scoring worm's totals equal the published team score everywhere
- all 12 season totals on the player pages equal the sum of the underlying
  match rows, across 3,972 player-seasons
- ladder W/D/L, points for and points against reconcile with home-and-away
  results in every season, including both 2020 conferences
- `kicks + handballs = disposals` in all 29,878 rows

Three contradictions survive, all in the source:

| Match | Problem |
|---|---|
| `2021-1-fre-gws` | Player goals total 7–5; the team score says 8–4 |
| `2024-6-fre-haw` | Hawthorn player behinds total 4, one short of behinds minus rushed |

These need a decision — trust the team score, trust the player table, or
record both — before the normalised import runs.

## What this source does not have

No attendance, no umpires, no lineups beyond the position column, and no
player biographical data: no date of birth, height or weight. No awards
either — no best-and-fairest, Rising Star or All-Australian. The
leading-goalkicker page is derivable from the player statistics and is used
as a check, not a source.
