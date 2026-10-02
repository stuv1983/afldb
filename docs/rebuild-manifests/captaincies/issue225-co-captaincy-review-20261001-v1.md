# AFLDB-ISSUE-225 — captaincies co-captain review (S1), v1

**Access date for every source: 2026-10-01.** Prepared under operator decisions D1–D3, D9
(`issues/closed/AFLDB-ISSUE-225.md` §23). This manifest is the provenance for the seven rows that S1 adds
to `data/awards/captaincies.csv`. It contains short supporting excerpts only, not reproductions of the
sources.

**Source policy (D1, Route W).** Every row stays `source_citation = wikipedia`. That value is the
family's source-granularity label (`tools/migration/captaincies.py`). Each row's `note` names the exact
Wikipedia page, following the Fred Phillips precedent (`(Wikipedia: Fred Phillips (footballer))`).
Official-club text is corroboration only; it is recorded here and named in the note. No loader, source
registry or reload-scope change.

**Admission rule (runbook §18.1):**

- A cited page names the player as captain or co-captain of that club for that season. A sustained
  appointment, including the rest of a season after a predecessor departs, qualifies.
- Club-season completeness: every captain the page names for the covered club-season is carried.
- The player resolves through the identity census to exactly one profile.
- Rows are additive. No existing row, `source_key` or `period` is edited (D9).

## 1. Governing sources (Wikipedia)

### W1 — List of Gold Coast Suns captains

- URL: <https://en.wikipedia.org/wiki/List_of_Gold_Coast_Suns_captains>; read as wikitext
  (`?action=raw`), revision 1365013852 (2026-07-19T20:06:33Z).
- AFL captains table, as excerpted:
  - `2017–2018` {efn: "Co-captains"} | Tom Lynch / Steven May
  - `2019–2021` {efn: "Co-captains"} | David Swallow / Jarrod Witts
  - `2022–2024` {efn: "Co-captains"} | Jarrod Witts / Touk Miller
- The page's own citations for those rows are:
  - ABC News, 18 October 2018: "Gold Coast Suns' problems are not limited to keeping captains like Tom
    Lynch and Steven May — but it's a start".
  - Inside Gold Coast, 11 April 2019: "David Swallow, Gold Coast Suns co-captain".
  - AFL.com.au, 21 February 2022: "'Childhood dream' for new Suns skipper, foundation star steps down".
- **Supports:** Steven May, Gold Coast 2017 and 2018; Jarrod Witts, Gold Coast 2019, 2020 and 2021.
  Each is a co-captain of a full season span.
- Consistent with the player page: Steven May (revision 1374455742) lists "Gold Coast captain:
  2017–2018" and says "May was named a co-captain of the Gold Coast Football Club in December 2016".

### W2 — 2008 Melbourne Football Club season

- URL: <https://en.wikipedia.org/wiki/2008_Melbourne_Football_Club_season>; read as wikitext,
  revision 1369103444 (2026-08-12T22:57:45Z).
- Infobox `captain` field, as excerpted: "David Neitz (9th season) (rounds 1–5) / James McDonald (1st
  season) (rounds 6–22) / Cameron Bruce (1st season) (rounds 6–22)".
- Prose: Neitz "announced his retirement on 19 May", and "For the remainder of the year, the captaincy
  was shared between Cameron Bruce and James McDonald".
- **Supports:** Cameron Bruce and James McDonald, Melbourne 2008. They were co-captains for rounds
  6–22 (17 of 22 home-and-away rounds), the sustained-successor shape migration 098 treats as an
  ordinary captain appointment. Neitz's existing 2008 row (`2000–2008`) stays as it is (D9).
- Consistent with the player page: Cameron Bruce (revision 1377815865) lists "captain: 2008" and says
  "Following the retirement of David Neitz in 2008, Bruce was named co-captain of the team alongside
  James McDonald for the remainder of the season."

## 2. Independent corroboration (recorded, not the citation)

| Id | Source | URL | Excerpt | Supports |
|---|---|---|---|---|
| C1 | Gold Coast SUNS, "SUNS reveal 2018 leadership group" | <https://goldcoastfc.com.au/news/2018-02-21/suns-reveal-2018-leadership-group> | "Tom Lynch & Steven May will once again captain the club in 2018." Coach Stuart Dew: they "have earned the privilege of captaining our club for a second year" | May 2017 and 2018 |
| C2 | Gold Coast SUNS, "SUNS lock in leaders for 2026" (captaincy history panel) | <https://www.goldcoastfc.com.au/news/1955952/suns-lock-in-leaders-for-2026> | "Tom Lynch & Steven May (2017-2018)"; "David Swallow & Jarrod Witts (2019-2021)" | May 2017–18; Witts 2019–21 |
| C3 | Melbourne FC, "Bruce announces his retirement" (Matt Burgan) | <https://www.melbournefc.com.au/news/773510/bruce-announces-his-retirement> | "In 2008, when David Neitz was injured early in the season and retired during it, Bruce stepped up as co-acting captain with James McDonald." | Bruce and McDonald 2008 |

**C3 reading note.** C3 calls the arrangement "co-acting captain". The next sentence reads "He was then
vice-captain under McDonald in 2008". It is internally inconsistent with the preceding sentence and
with W2 and the Bruce article, which name McDonald sole captain and Bruce vice-captain for **2009**. That
reads as a year slip in the club text. It does not change the 2008 finding: W2 is the governing source,
and both W2 and C3 agree that Bruce and McDonald jointly led the side for the rest of 2008 after Neitz.
The operator-supplied corroboration (Melbourne FC records McDonald and Bruce taking over after Neitz's
mid-season retirement) is the same fact.

## 3. Rows added

`source_key` is the first 24 hex characters of SHA-1(`issue225|<club>|<season>|<player>|<period>`)
(UTF-8), following the ISSUE-118 Family B precedent. Each row is inserted at its sorted position.
`player_id` is the bootstrap id, resolved at load through `data/awards/player-identity.csv`:

- Steven May 11940: `players/S/Steven_May.html`
- Jarrod Witts 12177: `players/J/Jarrod_Witts.html`
- Cameron Bruce 747: `players/C/Cameron_Bruce.html`
- James McDonald 730: `players/J/James_McDonald.html`

| source_key | season | club | player | id | period | Cites |
|---|---:|---|---|---:|---|---|
| `25f8dac05c6995eb838d7bef` | 2017 | Gold Coast | Steven May | 11940 | `2017–2018 (co-captain)` | W1; C1, C2 |
| `3469269fae62fa9aa25d705d` | 2018 | Gold Coast | Steven May | 11940 | `2017–2018 (co-captain)` | W1; C1, C2 |
| `91b499dcbe61d3386183fc8e` | 2019 | Gold Coast | Jarrod Witts | 12177 | `2019–2021 (co-captain)` | W1; C2 |
| `2c4db502ad00390a4f74db74` | 2020 | Gold Coast | Jarrod Witts | 12177 | `2019–2021 (co-captain)` | W1; C2 |
| `c9d6a0dffa2a7035f52c66e7` | 2021 | Gold Coast | Jarrod Witts | 12177 | `2019–2021 (co-captain)` | W1; C2 |
| `0a590b03a95e13bcfac2c41c` | 2008 | Melbourne | Cameron Bruce | 747 | `2008 (co-captain, rounds 6–22)` | W2; C3 |
| `8dbd379972bbe7f8ecf68a10` | 2008 | Melbourne | James McDonald | 730 | `2008 (co-captain, rounds 6–22)` | W2; C3 |

**Notes,** verbatim in the CSV:

- May: `co-captain with Tom Lynch (Wikipedia: List of Gold Coast Suns captains; corroborated: Gold Coast
  SUNS 2018 leadership announcement and captaincy history)`
- Witts: `co-captain with David Swallow (Wikipedia: List of Gold Coast Suns captains; corroborated: Gold
  Coast SUNS captaincy history)`
- Bruce: `co-captain with James McDonald for the remainder of 2008 after David Neitz retired (Wikipedia:
  2008 Melbourne Football Club season; corroborated: Melbourne FC)`
- McDonald: the same, naming Cameron Bruce.

**Period text.** The span is the page's own span: W1's table years, and W2's "rounds 6–22". The
`(co-captain)` marker is the existing GWS convention (`2012–2019 (co-captain)`).

**Completeness checked against the same pages:**

- W1's 2017–18 and 2019–21 rows name exactly two captains each. The CSV now carries both (Lynch and
  Swallow were already present).
- W2 names exactly three 2008 captains: Neitz, plus McDonald and Bruce. All three are now carried.
- W1's 2022–24 row (Witts, Miller) was not reviewed for change. The CSV's existing Witts 2022–24 rows
  are untouched, and the Miller rows are outside this slice.

**Not changed:**

- the bootstrap Lynch 2017–18, Swallow 2019–21 and Neitz 2000–08 rows (D9);
- `player-identity.csv`;
- `SOURCE_CITATIONS`;
- migration 098. Its "1,774 rows" comment is historical: it is an applied migration, and the count is
  now 1,781.

**Gridley consequence:** see the runbook (§18.5 and §24.4). The Bruce row makes AFLDB list him on
pre-2026 `captain` cells where Gridley's key omits him. Those cells are handled by the tracked
adjudication in `data/players/gridley-known-answer-adjudications.csv`, which landed in the same slice
(D8).
