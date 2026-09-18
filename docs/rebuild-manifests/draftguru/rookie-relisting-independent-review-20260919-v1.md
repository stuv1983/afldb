# AFLDB-ISSUE-222 — independent-source review pack: eight claimed rookie re-listings (D2)

Prepared 2026-09-19 (Fable 5.1) under operator decision **D2 — PENDING** (`AFLDB-ISSUE-222.md`
§11.19.12), with rows left blank pending an authorised network-enabled pass. **Completed
2026-09-19 (Sonnet 5)** under `AFLDB-ISSUE-222.md` §11.19.13: every source below was opened over
the network and read; every row now carries a verdict. This pack changes **nothing** in the
canonical database or bridge artefacts by itself — it is the evidentiary basis for the tracked
outcome artefact (`data/players/rookie-relisting-outcomes.csv`) and the narrow classifier rule
(`rookieSourceCoverageGap`, `tests/gridley-corpus-support.ts`) that reads it; see §11.19.13 for
what those changed.

**All eight players: Gridley supported.** Every one of the eight has at least one independent
source (six primary AFL/club, two reputable specialist secondary) confirming a Rookie Draft
selection or administrative re-listing that DraftGuru's linked page omits. No player is
Undetermined; none is DraftGuru-supported. A citation below names the page/publisher and gives a
short extract (never a long quotation) supporting the draft year, club and pick number/category;
where only a secondary source gives the pick number, that is stated explicitly.

## The question, per player

Gridley's `pickrookie` reads *"Player has been selected in a Rookie Draft (1996 to present)."*
Gridley lists each player below; the player's linked DraftGuru page (Stage A
`data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl`) carries **no Rookie event**, so
AFLDB's `draft_type_is(rookie)` omits him. All eight are bridged and trusted-linked
(`offline_strong`, `population_clean`, `retain_bridge`; present in the `afldb_test` child), so the
disagreement is not a link gap. Each case resolves to exactly one of:

- **Gridley supported** — an independent source shows a Rookie Draft selection DraftGuru omits
  (a *DraftGuru source coverage gap*: the late-career "delist and re-select in the Rookie Draft"
  pattern; DraftGuru does record such rows when its annual page carries them — GWS's Sam Reid,
  `sam_reid/2`, has 2015 Rookie pick 8 after 2007 National / 2011 Pre-Draft).
- **DraftGuru supported** — no independent source shows any Rookie Draft selection (Gridley's
  own key is wrong for the player).
- **Undetermined** — sources conflict or none is found; stays open.

Sources the reviewer should consult, in this order: (1) the club's or the AFL's announcement of
the relevant Rookie Draft (afl.com.au "Rookie Draft" results pages, club news pages), (2) the
player's Wikipedia article and its cited references (draft history infobox and prose), (3) the
Wikipedia article for that year's AFL Rookie Draft (a full pick list), (4) DraftGuru's own
person page and the relevant Rookie Draft year page (to confirm the omission is on the site, not
in Stage A parsing). AFL Tables does not record list category and is not a source here.

## Per-player review rows

Fill every blank. `Pick / category` is the Rookie Draft pick number, or the list category
(e.g. "Category A rookie", "pre-season supplemental selection") when the source gives one.

| # | AFLDB id | Canonical name | Linked DraftGuru person | DraftGuru rows on the linked page | Expected finding (UNVERIFIED recollection, superseded below) | Independent source(s) — URL, publisher, extract | Draft year | Club | Pick / category | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 57 | Adam Schneider | `adam_schneider/1` → `players/A/Adam_Schneider.html` | 2001 National pick 60 Sydney; 2007 Trade St Kilda | St Kilda delisted and re-selected him in a Rookie Draft late in his career | `saints.com.au/news/716512/rookie-pick-54-adam-schneider` (St Kilda FC, primary): "ST KILDA has re-drafted experienced half-forward Adam Schneider with pick 54 in this morning's National Draft" (headline: "Rookie pick 54: Adam Schneider"). Corroborated by Wikipedia "Adam Schneider": de-listed end of 2014, re-drafted as a mature-age rookie for 2015. | 2014 | St Kilda | 54 | **Gridley supported** |
| 2 | 8350 | Lachie Henderson | `lachie_henderson/1` → `players/L/Lachie_Henderson.html` | 2007 National pick 8 Brisbane; 2009 Trade Carlton; 2015 Trade Geelong | Geelong delisted and re-selected him in a Rookie Draft | `geelongcats.com.au/news/537374/wells-reviews-all-cats-2019-draftees` (Geelong FC, primary): "Lachie Henderson, 196cm; Pick 35, Rookie Draft, Geelong Football Club". | 2019 | Geelong | 35 | **Gridley supported** |
| 3 | 10673 | Phil Davis | `phil_davis/1` → `players/P/Phil_Davis.html` | 2008 National pick 10 Adelaide; 2011 Pre-Draft GWS (`Uncontracted`) | GWS moved him to the rookie list via a Rookie Draft late in his career | `central.rookieme.com/afl/2022/11/30/pick-by-pick-2022-afl-rookie-draft/` (Rookie Me Central, **secondary, specialist draft-tracking site**): "Pick 3 (GWS) – Phil Davis*" (asterisk = re-listed), corroborated by the same site's separate GWS 2022 draft review: "#3 Phil Davis (re-listed)". No primary AFL/GWS article naming the pick number was found (`en.wikipedia.org/wiki/2022_AFL_draft` could not be fully retrieved to cross-check; the GWS player-profile page carries no draft-history text). | 2022 | Greater Western Sydney | 3 | **Gridley supported** (weaker secondary evidence) |
| 4 | 11672 | Sam Reid (Sydney, born 1991) | `sam_reid/3` → `players/S/Sam_Reid2.html` | 2009 National pick 38 Sydney | Sydney delisted and re-selected him in a Rookie Draft | `afl.com.au/news/1066725/…-sam-reid-to-return-to-training-after-rookie-draft…` (AFL, primary): "Reid was selected at pick No.11 in the Rookie Draft with Sydney also selecting Indhi Kirk … as a Category B Rookie." Sydney's own Wikipedia infobox agrees: "No. 11, 2024 rookie draft (Sydney)". Confirmed as the Sydney forward born 1991 (181 games since the 2009 draft, retired 2024), not GWS's `sam_reid/2` (born 1989). | 2023 (for the 2024 season) | Sydney | 11 | **Gridley supported** |
| 5 | 8793 | Lewis Taylor | `lewis_taylor/1` → `players/L/Lewis_Taylor.html` | 2013 National pick 28 Brisbane; 2019 Trade Sydney | Sydney re-selected him in a Rookie Draft after delisting | `sydneyswans.com.au/news/1034087/swans-re-list-lewis-taylor-in-rookie-draft` (Sydney Swans, primary): "the Sydney Swans have re-listed experienced forward Lewis Taylor with pick 10." | 2021 | Sydney | 10 | **Gridley supported** |
| 6 | 10348 | Paul Seedsman | `paul_seedsman/1` → `players/P/Paul_Seedsman.html` | 2010 National pick 76 Collingwood; 2015 Trade Adelaide | Adelaide re-selected him in a Rookie Draft late in his career | `afl.com.au/news/870170/who-did-you-pick-the-full-rundown-on-every-clubs-2022-draft-haul` (AFL, primary), Adelaide section, Rookie Draft list: "21. Paul Seedsman (re-listed)". | 2022 | Adelaide | 21 | **Gridley supported** |
| 7 | 9575 | Michael Rischitelli | `michael_rischitelli/1` → `players/M/Michael_Rischitelli.html` | 2003 National pick 61 Brisbane; 2010 Pre-Draft Gold Coast | Gold Coast delisted and re-selected him in a Rookie Draft | `goldcoastfc.com.au/news/2018-08-30/rischitelli-to-play-on-in-2019` (Gold Coast SUNS, primary): "Rischitelli will continue his career as a Rookie listed player, with the GC SUNS committing to select Rischitelli at the NAB AFL Rookie Draft on Friday 23rd November" [2018] — no pick number given. `en.wikipedia.org/wiki/Michael_Rischitelli` (**secondary**), "2019 AFL rookie draft" section: listed as the first round's second selection (pick 2). Pick number sourced from Wikipedia only. | 2018 (Wikipedia labels the season-fed draft "2019") | Gold Coast | 2 | **Gridley supported** (pick number from weaker secondary evidence) |
| 8 | 2443 | Bryce Gibbs | `bryce_gibbs/1` → `players/B/Bryce_Gibbs.html` | 2006 National pick 1 Carlton; 2017 Trade Adelaide | Least certain of the eight: no re-listing recalled with confidence | Zero Hanger, "Crows to re-draft Bryce Gibbs with Pick 1 in rookie draft" (**secondary**, citing The Age's Daniel Cherny, 10 Dec 2020): "Adelaide is set to take Bryce Gibbs with the first pick of the rookie draft for administrative purposes"; "He will not play in the AFL in 2021, having signed with a SANFL club"; re-drafted "purely for salary cap purposes". No primary AFL/Crows article naming the pick was found; corroborated by general reporting of the same event (first player ever picked No. 1 in both a national and a rookie draft). | 2020 (for the 2021 season, inactive) | Adelaide | 1 (inactive rookie-list retention) | **Gridley supported** (weaker secondary evidence) |

## Corpus cells at stake (report sha256 `7f14ff2c…`)

| AFLDB id | `pickrookie` cells |
|---|---|
| 57 | #81 2-0, 2-1; #151 2-2 |
| 8350 | #81 2-1; #151 2-2; #169 2-1 |
| 10673 | #81 2-1; #151 2-2; #169 2-0, 2-2 |
| 11672 | #81 2-1; #151 2-2 |
| 8793 | #151 2-2 |
| 10348 | #151 2-2; #169 2-0 |
| 9575 | #81 2-1, 2-2; #151 2-2 |
| 2443 | #81 2-1, 2-2; #151 2-2; #169 2-0, 2-1 |

23 cells in total. All eight players are **Gridley supported** (above), so all 23 cells move from
`incorrect known answer` to `source coverage gap` on the next full corpus run (not yet run in this
pass) — counted and named, still `DATA_GAPS` (fails strict acceptance; counted in diagnostic mode),
never silently accepted.

## What happened after the verdicts (§11.19.13, 2026-09-19)

All eight verified as **Gridley supported**, so only that branch of the pack's original three-way
plan applied:

- Recorded as a per-person DraftGuru source coverage gap in a new tracked outcome artefact,
  `data/players/rookie-relisting-outcomes.csv` (one row per player, keyed by the AFL Tables
  profile, never by name or database id; verdict `gridley_supported` for all eight; the other two
  verdict values, `draftguru_supported` and `undetermined`, exist in the artefact's contract for a
  future review but are not used by any row here).
- `rookieSourceCoverageGap` (`tests/gridley-corpus-support.ts`, pure, DB-free) reads that artefact's
  outcome for the exact player and fires only when the axis is `draft_type_is(rookie)`, the triage
  cause is `no_linked_row_matches`, and the outcome's verdict is `gridley_supported` — never a
  general "no Rookie row" rule, and never for a player the artefact does not name.
- `tests/integration/gridley-corpus.test.ts` classifies the resulting cells `source coverage gap`
  (the same category `has_brother` already uses, §23.31) instead of `incorrect known answer`; the
  category still fails strict acceptance and is counted/named in diagnostic mode.
- No player is DraftGuru-supported or Undetermined; no `external source disagreement` rule was
  needed for this pack.

Nothing here weakened `tests/integration/gridley-corpus.test.ts`'s acceptance: `source coverage
gap` remains a `DATA_GAPS` category, not an informational one, and no unreviewed player's cells are
affected. A full corpus rerun was **not** performed in this pass (not authorised); the movement
above is a projection pending that rerun.
